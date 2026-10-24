import Link from "next/link";
import { loadProfile } from "@/lib/config";
import { listPostings, type PostingRow, recentRuns, type RunRow } from "@/lib/db";
import { formatDate, formatSalary } from "@/lib/report";
import { markPosting } from "./actions";
import { RunButton } from "./RunButton";

// "Run now" executes the whole pipeline inside a server action on this page.
export const maxDuration = 300;

const VIEWS = [
  { key: "new", label: "New" },
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "skip", label: "Skipped" },
  { key: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "new";

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return <Setup />;

  const { config } = loadProfile();
  const tz = config.candidate.timezone;
  let rows: PostingRow[] = [];
  let runs: RunRow[] = [];
  let dbError: string | null = null;
  try {
    [rows, runs] = await Promise.all([listPostings({ view, days: 14, limit: 100 }), recentRuns(8)]);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  const last = runs[0];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">L&amp;D roles</h1>
          <p className="mt-1 text-sm text-muted">
            {last ? (
              <>
                Last run {last.started_at.toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}
                {last.error ? " · failed" : last.stats ? ` · ${last.stats.afterFilters} passed filters, ${last.stats.reported} new` : " · in progress"}
              </>
            ) : (
              "No runs yet"
            )}
          </p>
        </div>
        <RunButton />
      </header>

      <nav className="mt-6 flex gap-1 overflow-x-auto text-sm">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "new" ? "/" : `/?view=${v.key}`}
            className={`rounded-md px-3 py-1.5 whitespace-nowrap ${view === v.key ? "bg-card font-medium shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {dbError ? (
        <p className="mt-8 rounded-md border border-flag/40 p-4 text-sm text-flag">Database error: {dbError}</p>
      ) : rows.length === 0 ? (
        <p className="mt-10 text-center text-muted">
          {view === "new" ? "Nothing new in the last 14 days. Run the pipeline to fetch roles." : "Nothing here yet."}
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-line">
          {rows.map((r, i) => (
            <Posting key={r.id} row={r} rank={i + 1} tz={tz} />
          ))}
        </ol>
      )}

      {runs.length > 0 && <Runs runs={runs} tz={tz} />}
    </main>
  );
}

function scoreColor(score: number) {
  return score >= 70 ? "text-good" : score >= 55 ? "text-mid" : "text-low";
}

function Posting({ row: r, rank, tz }: { row: PostingRow; rank: number; tz: string }) {
  const where =
    r.remote_type === "remote" ? (r.location && !/remote/i.test(r.location) ? `Remote · ${r.location}` : "Remote") : `${r.location}${r.remote_type === "hybrid" ? " (hybrid)" : ""}`;
  return (
    <li className="flex gap-4 py-5">
      <div className="w-10 shrink-0 text-right">
        <div className={`font-serif text-2xl leading-none font-semibold tabular-nums ${scoreColor(r.score)}`}>{r.score}</div>
        <div className="mt-1 text-xs text-muted">#{rank}</div>
      </div>
      <div className="min-w-0 flex-1">
        <a href={r.url} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:underline">
          {r.title}
        </a>
        <div className="mt-0.5 text-sm text-muted">
          <span className="text-ink">{r.company}</span> · {where} ·{" "}
          <span className={r.salary_min ? "text-ink" : ""}>{formatSalary(r.salary_min, r.salary_max)}</span> · posted{" "}
          {formatDate(r.posted_at ?? r.first_seen_at, tz)}
        </div>
        {r.llm_reason && <p className="mt-2 text-sm leading-relaxed">{r.llm_reason}</p>}
        {r.red_flags && r.red_flags.length > 0 && <p className="mt-1 text-sm text-flag">⚑ {r.red_flags.join(" · ")}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-link">
            Apply →
          </a>
          <span className="mx-1 text-line">|</span>
          {(["saved", "applied", "skip"] as const).map((s) => (
            <form key={s} action={markPosting}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value={r.status === s ? "clear" : s} />
              <button
                type="submit"
                className={`rounded px-2 py-0.5 ring-1 ${r.status === s ? "bg-ink text-paper ring-ink" : "text-muted ring-line hover:text-ink"}`}
              >
                {s === "skip" ? "Skip" : s === "saved" ? "Save" : "Applied"}
              </button>
            </form>
          ))}
          <span className="ml-auto text-xs text-muted" title={r.score_parts ? Object.entries(r.score_parts).map(([k, v]) => `${k} ${Math.round(v)}`).join(" · ") : ""}>
            {r.sources.join(", ")} · {r.id}
          </span>
        </div>
      </div>
    </li>
  );
}

function Runs({ runs, tz }: { runs: RunRow[]; tz: string }) {
  return (
    <section className="mt-12 border-t border-line pt-6">
      <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Recent runs</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {runs.map((run) => {
          const s = run.stats;
          const errors = s ? Object.values(s.sourceErrors).reduce((n, e) => n + e.length, 0) : 0;
          return (
            <li key={run.id} className="flex flex-wrap gap-x-3">
              <Link href={`/runs/${run.id}`} className="text-link">
                {run.started_at.toLocaleString("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" })}
              </Link>
              <span className="text-muted">{run.kind}</span>
              {run.error ? (
                <span className="text-flag">failed</span>
              ) : s ? (
                <span className="text-muted">
                  {Object.values(s.fetched).reduce((a, b) => a + b, 0)} fetched → {s.afterDedupe} deduped → {s.afterFilters} kept · {s.reported} new
                  {errors ? ` · ${errors} source errors` : ""} · {Math.round(s.durationMs / 1000)}s{s.emailed ? " · emailed" : ""}
                </span>
              ) : (
                <span className="text-muted">running</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Setup() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-serif text-3xl font-semibold">L&amp;D roles</h1>
      <p className="mt-4 text-muted">
        Connect a Postgres database to start: set <code className="text-ink">DATABASE_URL</code> (Neon or Supabase both work)
        and redeploy. The schema is created on the first run.
      </p>
    </main>
  );
}
