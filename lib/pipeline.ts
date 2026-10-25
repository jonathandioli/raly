import { createHash } from "node:crypto";
import { loadProfile } from "./config";
import * as store from "./db";
import { dedupe } from "./dedupe";
import { emailConfigured, sendReport } from "./email";
import { applyFilters } from "./filter";
import { pMap } from "./http";
import { normalize } from "./normalize";
import { type ReportItem, renderHtml, renderMarkdown } from "./report";
import { scorePosting } from "./score";
import { applyOverrides, getListOverrides } from "./settings";
import { rateFit, semanticEnabled, semanticHash } from "./semantic";
import { fetchAll } from "./sources";
import type { Posting, ScoredPosting, SemanticResult } from "./types";

export interface RunOptions {
  /** Read only: no database writes, no email. */
  dryRun?: boolean;
  email?: boolean;
  /** Force the weekly digest on or off; by default it runs on the configured weekday. */
  digest?: boolean;
  kind?: string;
  /** Override profile.posted_within_days for this run, e.g. a one-time backfill. */
  maxAgeDays?: number;
  log?: (msg: string) => void;
}

export interface RunResult {
  runId: number | null;
  markdown: string;
  html: string;
  stats: store.RunStats;
  top: ScoredPosting[];
}

/** A posting is re-sent only when what the candidate sees in the report (title, salary) changes. */
export const reportHash = (p: Pick<Posting, "title" | "salaryMin" | "salaryMax">) =>
  createHash("sha1").update(`${p.title}|${p.salaryMin ?? ""}|${p.salaryMax ?? ""}`).digest("hex").slice(0, 16);

const hasDb = () => !!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);

function toItem(p: ScoredPosting): ReportItem {
  return {
    id: p.id,
    score: p.score,
    title: p.title,
    company: p.company,
    location: p.location,
    remoteType: p.remoteType,
    salaryMin: p.salaryMin,
    salaryMax: p.salaryMax,
    postedAt: p.postedAt,
    reason: p.semantic?.reason ?? null,
    redFlags: p.semantic?.red_flags ?? [],
    url: p.url,
  };
}

function rowToItem(r: store.PostingRow): ReportItem {
  return {
    id: r.id,
    score: r.score,
    title: r.title,
    company: r.company,
    location: r.location,
    remoteType: r.remote_type,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    postedAt: r.posted_at,
    reason: r.llm_reason,
    redFlags: r.red_flags ?? [],
    url: r.url,
  };
}

export async function runPipeline(opts: RunOptions = {}): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const started = Date.now();
  const profile = loadProfile();
  const { config } = profile;
  if (opts.maxAgeDays) config.profile.posted_within_days = opts.maxAgeDays;
  const useDb = hasDb();
  const write = useDb && !opts.dryRun;

  if (useDb) {
    await store.ensureSchema();
    // Keyword lists edited on the dashboard replace config.yaml's for this run.
    applyOverrides(config, await getListOverrides());
  }
  const runId = write ? await store.startRun(opts.kind ?? "daily") : null;

  try {
    // 1. Fetch
    log("Fetching sources…");
    const results = await fetchAll(profile);
    const fetched = Object.fromEntries(results.map((r) => [r.source, r.postings.length]));
    const sourceErrors = Object.fromEntries(results.map((r) => [r.source, r.errors]));
    log(`Fetched ${JSON.stringify(fetched)}`);

    // 2. Normalize
    const now = new Date();
    const normalized = results
      .flatMap((r) => r.postings)
      .filter((r) => r.title && r.url && r.company)
      .map((r) => normalize(r, now));

    // 3. Deduplicate, against this run and against what's already stored
    const known = useDb ? await store.knownPostings([...new Set(normalized.map((p) => p.company))]) : [];
    const deduped = dedupe(normalized, known);

    // 4. Filter
    const { kept, rejected } = applyFilters(deduped, config, now);
    log(`${normalized.length} normalized → ${deduped.length} after dedupe → ${kept.length} after filters`);

    // 5. Score: LLM verdicts are cached per (posting content, profile); only new or changed postings are sent.
    const cached = useDb ? await store.cachedVerdicts(kept.map((p) => p.id)) : new Map();
    const skipped = useDb ? await store.skippedRoles() : [];
    const verdicts = new Map<string, { hash: string; verdict: SemanticResult | null; fresh: boolean }>();
    const toRate: Posting[] = [];
    for (const p of kept) {
      const hash = semanticHash(p, profile);
      const c = cached.get(p.id);
      if (c && c.hash === hash) verdicts.set(p.id, { hash, verdict: c.verdict, fresh: false });
      else toRate.push(p);
    }
    let llmErrors = 0;
    const budget = config.scoring.llm && semanticEnabled() ? toRate.slice(0, config.scoring.max_llm_calls_per_run) : [];
    if (budget.length) log(`Scoring ${budget.length} postings with ${config.scoring.model}…`);
    await pMap(budget, config.scoring.concurrency, async (p) => {
      try {
        verdicts.set(p.id, { hash: semanticHash(p, profile), verdict: await rateFit(p, profile), fresh: true });
      } catch (e) {
        llmErrors++;
        log(`LLM failed for ${p.id}: ${e instanceof Error ? e.message : e}`);
      }
    });

    const scored = kept
      .map((p) => {
        const v = verdicts.get(p.id);
        return { ...scorePosting(p, v?.verdict ?? null, config, skipped, now), llmHash: v?.fresh ? v.hash : null };
      })
      .sort((a, b) => b.score - a.score);

    if (write) await store.upsertPostings(scored);

    // 6. Report: top N not yet reported (or changed since), and not already marked.
    const state = useDb ? await store.reportState(scored.map((p) => p.id)) : new Map();
    const fresh = scored.filter((p) => {
      const s = state.get(p.id);
      return !s || (!s.status && s.reportedHash !== reportHash(p));
    });
    const top = fresh.slice(0, config.report.top_n);

    const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: config.candidate.timezone });
    const wantDigest = opts.digest ?? weekday.toLowerCase() === config.report.weekly_digest_day.toLowerCase();
    const topIds = new Set(top.map((p) => p.id));
    const digestRows = wantDigest && useDb
      ? (await store.unmarkedSince(7, config.report.weekly_digest_min_score)).filter((r) => !topIds.has(r.id))
      : [];

    const stats: store.RunStats = {
      fetched,
      sourceErrors,
      normalized: normalized.length,
      afterDedupe: deduped.length,
      afterFilters: kept.length,
      rejected,
      llmCalls: budget.length,
      llmCached: kept.length - toRate.length,
      llmErrors,
      reported: top.length,
      digest: digestRows.length,
      emailed: false,
      durationMs: 0,
    };

    const input = {
      date: now,
      timezone: config.candidate.timezone,
      items: top.map(toItem),
      digest: digestRows.map(rowToItem),
      stats,
      dashboardUrl: process.env.APP_URL,
    };

    const shouldEmail = (opts.email ?? true) && !opts.dryRun && emailConfigured() && (top.length > 0 || digestRows.length > 0);
    if (shouldEmail) {
      try {
        const subject = `${config.email.subject_prefix}: ${top.length} new${top[0] ? ` · ${top[0].title} @ ${top[0].company}` : ""}`;
        stats.durationMs = Date.now() - started;
        await sendReport(subject, renderHtml(input), renderMarkdown(input));
        stats.emailed = true;
      } catch (e) {
        stats.emailError = e instanceof Error ? e.message : String(e);
        log(`Email failed: ${stats.emailError}`);
      }
    }
    if (write) await store.markReported(top.map((p) => ({ id: p.id, hash: reportHash(p) })));

    stats.durationMs = Date.now() - started;
    const markdown = renderMarkdown(input);
    const html = renderHtml(input);
    if (runId) await store.finishRun(runId, { stats, reportMd: markdown, reportHtml: html });
    return { runId, markdown, html, stats, top };
  } catch (e) {
    if (runId) await store.finishRun(runId, { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    throw e;
  }
}
