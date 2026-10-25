import type { Profile, TargetCompany } from "../config";
import { pMap, redact } from "../http";
import type { RawPosting, SourceResult } from "../types";
import { fetchAshby, fetchGreenhouse, fetchLever } from "./ats";
import { fetchOracle } from "./oracle";
import { fetchSitemap } from "./sitemap";
import { fetchWorkday } from "./workday";
import { type Query, searchAdzuna, searchJSearch, searchSerpApi, searchUsaJobs } from "./search";

const errMsg = (e: unknown) => redact(e instanceof Error ? e.message : String(e));

async function runAts<C extends TargetCompany>(
  source: string,
  companies: C[],
  fn: (c: C) => Promise<RawPosting[]>,
): Promise<SourceResult> {
  const errors: string[] = [];
  const lists = await pMap(companies, 10, async (c) => {
    try {
      return await fn(c);
    } catch (e) {
      errors.push(`${c.name}: ${errMsg(e)}`);
      return [];
    }
  });
  return { source, postings: lists.flat(), errors };
}

async function runQueries(
  source: string,
  queries: Query[],
  limit: number,
  fn: (q: Query) => Promise<RawPosting[]>,
): Promise<SourceResult> {
  const errors: string[] = [];
  const lists = await pMap(queries, limit, async (q) => {
    try {
      return await fn(q);
    } catch (e) {
      errors.push(`"${q.keyword}" / ${q.location}: ${errMsg(e)}`);
      return [];
    }
  });
  return { source, postings: lists.flat(), errors };
}

export function buildQueries(profile: Profile): Query[] {
  const { config } = profile;
  return config.profile.title_keywords.flatMap((keyword) =>
    config.search_locations.map((location) => ({ keyword, location })),
  );
}

/** Stage 1: every enabled adapter, concurrently, each with its own rate limit. */
export async function fetchAll(profile: Profile): Promise<SourceResult[]> {
  const { config, companies } = profile;
  const s = config.sources;
  const queries = buildQueries(profile);
  const byAts = <A extends TargetCompany["ats"]>(ats: A) =>
    companies.filter((c): c is Extract<TargetCompany, { ats: A }> => c.ats === ats);
  const jobs: Promise<SourceResult>[] = [];

  if (s.greenhouse.enabled) jobs.push(runAts("greenhouse", byAts("greenhouse"), fetchGreenhouse));
  if (s.lever.enabled) jobs.push(runAts("lever", byAts("lever"), fetchLever));
  if (s.ashby.enabled) jobs.push(runAts("ashby", byAts("ashby"), fetchAshby));
  if (s.workday.enabled) jobs.push(runAts("workday", byAts("workday"), fetchWorkday));
  if (s.oracle.enabled) jobs.push(runAts("oracle", byAts("oracle"), fetchOracle));
  if (s.careersite.enabled) jobs.push(runAts("careersite", byAts("sitemap"), fetchSitemap));
  if (s.adzuna.enabled) {
    const opts = { country: s.adzuna.country, perPage: s.adzuna.results_per_page, maxDays: config.profile.posted_within_days };
    jobs.push(runQueries("adzuna", queries, 2, (q) => searchAdzuna(q, opts)));
  }
  // Paid/limited sources get a per-run query cap so a daily schedule stays inside the free tier.
  if (s.serpapi.enabled) jobs.push(runQueries("google_jobs", queries.slice(0, s.serpapi.max_queries_per_run), 1, searchSerpApi));
  if (s.jsearch.enabled) jobs.push(runQueries("jsearch", queries.slice(0, s.jsearch.max_queries_per_run), 1, searchJSearch));
  if (s.usajobs.enabled) jobs.push(runQueries("usajobs", queries, 2, searchUsaJobs));

  return Promise.all(jobs);
}
