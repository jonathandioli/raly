import postgres from "postgres";
import type { KnownPosting } from "./dedupe";
import type { SkippedRole } from "./score";
import type { MarkStatus, ScoredPosting, SemanticResult } from "./types";

let sql: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (sql) return sql;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare:false keeps it working behind transaction poolers (Supabase, Neon pooled URLs).
  sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, onnotice: () => {} });
  return sql;
}

const SCHEMA = `
create table if not exists postings (
  id text primary key,
  source text not null,
  sources text[] not null default '{}',
  source_kind text not null,
  url text not null,
  title text not null,
  company text not null,
  location text not null default '',
  remote_type text not null,
  salary_min integer,
  salary_max integer,
  salary_currency text,
  posted_at timestamptz,
  description_text text not null default '',
  fetched_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  dedupe_key text not null,
  score integer,
  score_parts jsonb,
  llm_hash text,
  llm_score real,
  llm_reason text,
  red_flags jsonb,
  reported_at timestamptz,
  reported_hash text
);
create index if not exists postings_company_idx on postings (lower(company));
create index if not exists postings_score_idx on postings (score desc);

create table if not exists runs (
  id serial primary key,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb,
  report_md text,
  report_html text,
  error text
);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists status (
  posting_id text primary key references postings(id) on delete cascade,
  status text not null check (status in ('applied', 'skip', 'saved')),
  marked_at timestamptz not null default now()
);
`;

export async function ensureSchema() {
  await db().unsafe(SCHEMA);
}

export async function knownPostings(companies: string[]): Promise<KnownPosting[]> {
  if (!companies.length) return [];
  const rows = await db()`
    select id, company, title, location, remote_type from postings
    where lower(company) in ${db()(companies.map((c) => c.toLowerCase()))}`;
  return rows.map((r) => ({ id: r.id, company: r.company, title: r.title, location: r.location, remoteType: r.remote_type }));
}

export async function cachedVerdicts(ids: string[]): Promise<Map<string, { hash: string; verdict: SemanticResult }>> {
  if (!ids.length) return new Map();
  const rows = await db()`
    select id, llm_hash, llm_score, llm_reason, red_flags from postings
    where id in ${db()(ids)} and llm_hash is not null`;
  return new Map(
    rows.map((r) => [r.id, { hash: r.llm_hash, verdict: { score: r.llm_score, reason: r.llm_reason ?? "", red_flags: r.red_flags ?? [] } }]),
  );
}

export async function upsertPostings(postings: (ScoredPosting & { llmHash: string | null })[]) {
  const sql = db();
  for (const p of postings) {
    await sql`
      insert into postings ${sql({
        id: p.id,
        source: p.source,
        sources: p.sources,
        source_kind: p.sourceKind,
        url: p.url,
        title: p.title,
        company: p.company,
        location: p.location,
        remote_type: p.remoteType,
        salary_min: p.salaryMin,
        salary_max: p.salaryMax,
        salary_currency: p.salaryCurrency,
        posted_at: p.postedAt,
        description_text: p.descriptionText,
        fetched_at: p.fetchedAt,
        dedupe_key: p.dedupeKey,
        score: p.score,
        score_parts: sql.json(p.parts),
        llm_hash: p.llmHash,
        llm_score: p.semantic?.score ?? null,
        llm_reason: p.semantic?.reason ?? null,
        red_flags: sql.json(p.semantic?.red_flags ?? []),
      })}
      on conflict (id) do update set
        source = excluded.source,
        sources = (select array(select distinct unnest(postings.sources || excluded.sources))),
        source_kind = excluded.source_kind,
        url = excluded.url,
        title = excluded.title,
        location = excluded.location,
        remote_type = excluded.remote_type,
        salary_min = excluded.salary_min,
        salary_max = excluded.salary_max,
        salary_currency = excluded.salary_currency,
        posted_at = least(postings.posted_at, excluded.posted_at),
        description_text = excluded.description_text,
        fetched_at = excluded.fetched_at,
        score = excluded.score,
        score_parts = excluded.score_parts,
        llm_hash = coalesce(excluded.llm_hash, postings.llm_hash),
        llm_score = coalesce(excluded.llm_score, postings.llm_score),
        llm_reason = coalesce(excluded.llm_reason, postings.llm_reason),
        red_flags = case when excluded.llm_hash is null then postings.red_flags else excluded.red_flags end`;
  }
}

/** What each id was last reported as, so a title or salary change makes it reportable again. */
export async function reportState(ids: string[]): Promise<Map<string, { reportedHash: string | null; status: string | null }>> {
  if (!ids.length) return new Map();
  const rows = await db()`
    select p.id, p.reported_hash, s.status from postings p
    left join status s on s.posting_id = p.id
    where p.id in ${db()(ids)}`;
  return new Map(rows.map((r) => [r.id, { reportedHash: r.reported_hash, status: r.status }]));
}

export async function markReported(items: { id: string; hash: string }[]) {
  const sql = db();
  for (const { id, hash } of items) {
    await sql`update postings set reported_at = now(), reported_hash = ${hash} where id = ${id}`;
  }
}

export async function skippedRoles(): Promise<SkippedRole[]> {
  const rows = await db()`
    select p.company, p.title from status s join postings p on p.id = s.posting_id where s.status = 'skip'`;
  return rows.map((r) => ({ company: r.company, title: r.title }));
}

export async function setStatus(id: string, status: MarkStatus | null) {
  const sql = db();
  if (!status) {
    await sql`delete from status where posting_id = ${id}`;
    return;
  }
  const res = await sql`
    insert into status (posting_id, status) select ${id}, ${status} where exists (select 1 from postings where id = ${id})
    on conflict (posting_id) do update set status = excluded.status, marked_at = now()`;
  if (res.count === 0) throw new Error(`No posting with id ${id}`);
}

export interface PostingRow {
  id: string;
  title: string;
  company: string;
  location: string;
  remote_type: string;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: Date | null;
  first_seen_at: Date;
  url: string;
  sources: string[];
  source_kind: string;
  score: number;
  score_parts: ScoredPosting["parts"] | null;
  llm_reason: string | null;
  red_flags: string[] | null;
  reported_at: Date | null;
  status: MarkStatus | null;
}

/** Roles scored >= minScore, posted in the window, that the candidate hasn't marked (weekly digest). */
export async function unmarkedSince(days: number, minScore: number): Promise<PostingRow[]> {
  return db()<PostingRow[]>`
    select p.*, s.status from postings p left join status s on s.posting_id = p.id
    where s.status is null and p.score >= ${minScore}
      and coalesce(p.posted_at, p.first_seen_at) > now() - make_interval(days => ${days})
    order by p.score desc limit 50`;
}

export async function listPostings(opts: { view: "new" | MarkStatus | "all"; days: number; limit: number }): Promise<PostingRow[]> {
  const sql = db();
  const statusFilter =
    opts.view === "all" ? sql`` : opts.view === "new" ? sql`and s.status is null` : sql`and s.status = ${opts.view}`;
  const ageFilter =
    opts.view === "new" || opts.view === "all"
      ? sql`and coalesce(p.posted_at, p.first_seen_at) > now() - make_interval(days => ${opts.days})`
      : sql``;
  return sql<PostingRow[]>`
    select p.id, p.title, p.company, p.location, p.remote_type, p.salary_min, p.salary_max, p.posted_at,
           p.first_seen_at, p.url, p.sources, p.source_kind, p.score, p.score_parts, p.llm_reason, p.red_flags,
           p.reported_at, s.status
    from postings p left join status s on s.posting_id = p.id
    where p.score is not null ${statusFilter} ${ageFilter}
    order by p.score desc, p.posted_at desc nulls last
    limit ${opts.limit}`;
}

export interface RunRow {
  id: number;
  kind: string;
  started_at: Date;
  finished_at: Date | null;
  stats: RunStats | null;
  report_md: string | null;
  report_html: string | null;
  error: string | null;
}

export interface RunStats {
  fetched: Record<string, number>;
  sourceErrors: Record<string, string[]>;
  normalized: number;
  afterDedupe: number;
  afterFilters: number;
  rejected: Record<string, number>;
  llmCalls: number;
  llmCached: number;
  llmErrors: number;
  reported: number;
  digest: number;
  emailed: boolean;
  emailError?: string;
  durationMs: number;
}

export async function startRun(kind: string): Promise<number> {
  const [row] = await db()`insert into runs (kind) values (${kind}) returning id`;
  return row.id;
}

export async function finishRun(id: number, data: { stats?: RunStats; reportMd?: string; reportHtml?: string; error?: string }) {
  const sql = db();
  await sql`
    update runs set finished_at = now(),
      stats = ${data.stats ? sql.json(data.stats as unknown as postgres.JSONValue) : null},
      report_md = ${data.reportMd ?? null}, report_html = ${data.reportHtml ?? null}, error = ${data.error ?? null}
    where id = ${id}`;
}

export async function recentRuns(limit = 10): Promise<RunRow[]> {
  return db()<RunRow[]>`select id, kind, started_at, finished_at, stats, error, null as report_md, null as report_html from runs order by id desc limit ${limit}`;
}

export async function getRun(id: number): Promise<RunRow | null> {
  const [row] = await db()<RunRow[]>`select * from runs where id = ${id}`;
  return row ?? null;
}
