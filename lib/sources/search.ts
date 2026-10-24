import { getJson } from "../http";
import type { RawPosting } from "../types";

// Keyword-search APIs. Each call is one title keyword in one location.

export interface Query {
  keyword: string;
  location: string;
}

const isRemote = (location: string) => /remote/i.test(location);

interface AdzunaResult {
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
  created?: string;
  redirect_url: string;
  description?: string;
}

export async function searchAdzuna(q: Query, opts: { country: string; perPage: number; maxDays: number }) {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) throw new Error("ADZUNA_APP_ID / ADZUNA_APP_KEY not set");
  const params = new URLSearchParams({
    app_id: id,
    app_key: key,
    what_phrase: q.keyword,
    max_days_old: String(opts.maxDays),
    results_per_page: String(opts.perPage),
    "content-type": "application/json",
  });
  // Adzuna has no remote flag; put "remote" in the keywords instead of the location.
  if (isRemote(q.location)) params.set("what_or", "remote");
  else params.set("where", q.location);
  const data = await getJson<{ results: AdzunaResult[] }>(
    `https://api.adzuna.com/v1/api/jobs/${opts.country}/search/1?${params}`,
  );
  return data.results.map<RawPosting>((r) => {
    // Adzuna fills in a modelled salary when the posting has none; that is a guess, not a listed range.
    const predicted = String(r.salary_is_predicted) === "1";
    return {
      source: "adzuna",
      sourceKind: "aggregator",
      url: r.redirect_url,
      title: r.title,
      company: r.company?.display_name ?? "",
      location: r.location?.display_name ?? "",
      salaryMin: predicted ? null : (r.salary_min ?? null),
      salaryMax: predicted ? null : (r.salary_max ?? null),
      salaryCurrency: predicted ? null : "USD",
      postedAt: r.created ?? null,
      description: r.description ?? "",
    };
  });
}

interface SerpJob {
  title: string;
  company_name?: string;
  location?: string;
  description?: string;
  detected_extensions?: { posted_at?: string; salary?: string; work_from_home?: boolean };
  apply_options?: { title?: string; link: string }[];
  share_link?: string;
}

export async function searchSerpApi(q: Query) {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY not set");
  const params = new URLSearchParams({
    engine: "google_jobs",
    q: `${q.keyword} ${isRemote(q.location) ? "remote" : ""}`.trim(),
    hl: "en",
    gl: "us",
    chips: "date_posted:week",
    api_key: key,
  });
  if (!isRemote(q.location)) params.set("location", q.location);
  const data = await getJson<{ jobs_results?: SerpJob[] }>(`https://serpapi.com/search.json?${params}`);
  return (data.jobs_results ?? []).map<RawPosting>((j) => {
    const direct = pickDirectLink(j.apply_options ?? [], j.company_name ?? "");
    return {
      source: "google_jobs",
      sourceKind: "aggregator",
      url: direct ?? j.apply_options?.[0]?.link ?? j.share_link ?? "",
      title: j.title,
      company: j.company_name ?? "",
      location: j.location ?? "",
      workplace: j.detected_extensions?.work_from_home ? "remote" : null,
      postedAt: relativeDate(j.detected_extensions?.posted_at),
      description: [j.description ?? "", j.detected_extensions?.salary ?? ""].join("\n"),
    };
  });
}

interface JSearchJob {
  job_title: string;
  employer_name?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
  job_apply_link: string;
  job_apply_is_direct?: boolean;
  job_description?: string;
}

export async function searchJSearch(q: Query) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("RAPIDAPI_KEY not set");
  const params = new URLSearchParams({
    query: isRemote(q.location) ? `${q.keyword} remote` : `${q.keyword} in ${q.location}`,
    date_posted: "week",
    country: "us",
    num_pages: "1",
  });
  if (isRemote(q.location)) params.set("work_from_home", "true");
  const data = await getJson<{ data?: JSearchJob[] }>(`https://jsearch.p.rapidapi.com/search?${params}`, {
    "X-RapidAPI-Key": key,
    "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
  });
  return (data.data ?? []).map<RawPosting>((j) => ({
    source: "jsearch",
    sourceKind: j.job_apply_is_direct ? "ats" : "aggregator",
    url: j.job_apply_link,
    title: j.job_title,
    company: j.employer_name ?? "",
    location: [j.job_city, j.job_state].filter(Boolean).join(", ") || (j.job_is_remote ? "Remote" : ""),
    workplace: j.job_is_remote ? "remote" : null,
    salaryMin: j.job_min_salary ?? null,
    salaryMax: j.job_max_salary ?? null,
    salaryCurrency: j.job_min_salary ? "USD" : null,
    salaryPeriod: j.job_salary_period?.toLowerCase() === "hour" ? "hour" : j.job_salary_period?.toLowerCase() === "month" ? "month" : "year",
    postedAt: j.job_posted_at_datetime_utc ?? null,
    description: j.job_description ?? "",
  }));
}

interface UsaJobsItem {
  MatchedObjectDescriptor: {
    PositionTitle: string;
    OrganizationName?: string;
    PositionLocationDisplay?: string;
    PositionURI: string;
    PublicationStartDate?: string;
    PositionRemuneration?: { MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }[];
    UserArea?: { Details?: { JobSummary?: string; MajorDuties?: string[] } };
  };
}

export async function searchUsaJobs(q: Query) {
  const key = process.env.USAJOBS_API_KEY;
  const email = process.env.CONTACT_EMAIL;
  if (!key || !email) throw new Error("USAJOBS_API_KEY / CONTACT_EMAIL not set");
  const params = new URLSearchParams({ Keyword: q.keyword, DatePosted: "7", ResultsPerPage: "50" });
  if (isRemote(q.location)) params.set("RemoteIndicator", "True");
  else params.set("LocationName", q.location);
  const data = await getJson<{ SearchResult: { SearchResultItems: UsaJobsItem[] } }>(
    `https://data.usajobs.gov/api/search?${params}`,
    { Host: "data.usajobs.gov", "User-Agent": email, "Authorization-Key": key },
  );
  return data.SearchResult.SearchResultItems.map<RawPosting>(({ MatchedObjectDescriptor: d }) => {
    const pay = d.PositionRemuneration?.[0];
    return {
      source: "usajobs",
      sourceKind: "ats",
      url: d.PositionURI,
      title: d.PositionTitle,
      company: d.OrganizationName ?? "US Government",
      location: d.PositionLocationDisplay ?? "",
      workplace: isRemote(q.location) ? "remote" : null,
      salaryMin: pay?.MinimumRange ? Number(pay.MinimumRange) : null,
      salaryMax: pay?.MaximumRange ? Number(pay.MaximumRange) : null,
      salaryCurrency: "USD",
      salaryPeriod: pay?.RateIntervalCode === "PH" ? "hour" : "year",
      postedAt: d.PublicationStartDate ?? null,
      description: [d.UserArea?.Details?.JobSummary ?? "", ...(d.UserArea?.Details?.MajorDuties ?? [])].join("\n"),
    };
  });
}

const AGGREGATOR_HOSTS = /linkedin|indeed|glassdoor|ziprecruiter|monster|simplyhired|talent\.com|jooble|adzuna|bebee|lensa/i;

/** Prefer the employer's own careers page or ATS over a board's copy of it. */
export function pickDirectLink(options: { title?: string; link: string }[], company: string): string | null {
  const companyWord = company.toLowerCase().split(/\s+/)[0] ?? "";
  const direct = options.find((o) => !AGGREGATOR_HOSTS.test(o.link) && (
    /greenhouse|lever\.co|ashbyhq|workday|smartrecruiters|icims|jobvite/i.test(o.link) ||
    (companyWord.length > 2 && o.link.toLowerCase().includes(companyWord))
  ));
  return direct?.link ?? null;
}

/** "3 days ago" -> Date. Google Jobs only gives relative ages. */
export function relativeDate(text: string | undefined, now = new Date()): Date | null {
  if (!text) return null;
  const m = text.match(/(\d+)\+?\s*(minute|hour|day|week|month)/i);
  if (!m) return /just|today/i.test(text) ? now : null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms = { minute: 6e4, hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9 }[unit] ?? 0;
  return new Date(now.getTime() - n * ms);
}
