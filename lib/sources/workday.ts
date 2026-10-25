import { USER_AGENT, getJson, pMap } from "../http";
import { titleLooksRelevant } from "../prefilter";
import type { Keywords } from "../config";
import type { RawPosting } from "../types";

// Workday career sites (most large employers) serve a public JSON API behind every
// <tenant>.wdN.myworkdayjobs.com/<site> page. Its search is a loose keyword OR, and a big
// employer lists thousands of jobs, so: run the configured search terms, screen titles, and fetch
// full details only for the survivors.

const PAGE = 20; // Workday's maximum page size
const PAGES_PER_SEARCH = 1; // results are relevance-sorted; one page keeps ~80 employers inside Vercel's 5-minute limit

export interface WorkdaySite {
  base: string; // https://tenant.wd5.myworkdayjobs.com
  tenant: string;
  site: string;
}

export function parseWorkdayUrl(url: string): WorkdaySite {
  const u = new URL(url);
  const tenant = u.hostname.split(".")[0];
  // Career URLs sometimes carry a locale first: /en-US/External
  const site = u.pathname.split("/").filter((s) => s && !/^[a-z]{2}-[A-Z]{2}$/.test(s))[0];
  if (!tenant || !site) throw new Error(`Not a Workday career site URL: ${url}`);
  return { base: `${u.protocol}//${u.hostname}`, tenant, site };
}

interface SearchResponse {
  total: number;
  jobPostings: { title: string; externalPath: string; locationsText?: string; postedOn?: string }[];
}

interface DetailResponse {
  jobPostingInfo: {
    title: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    remoteType?: string;
    jobDescription?: string;
    externalUrl: string;
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** "Flex" is Workday's word for hybrid. */
function workplace(remoteType?: string): string | null {
  const r = remoteType?.toLowerCase() ?? "";
  if (r.includes("remote")) return "remote";
  if (r.includes("flex") || r.includes("hybrid")) return "hybrid";
  if (r.includes("onsite") || r.includes("on-site") || r.includes("office")) return "onsite";
  return null;
}

export async function fetchWorkday(company: { name: string; url: string }, kw: Keywords): Promise<RawPosting[]> {
  const { base, tenant, site } = parseWorkdayUrl(company.url);
  const api = `${base}/wday/cxs/${tenant}/${site}`;

  const paths = new Map<string, string>(); // externalPath -> title
  for (const searchText of kw.search_terms) {
    for (let page = 0; page < PAGES_PER_SEARCH; page++) {
      const r = await postJson<SearchResponse>(`${api}/jobs`, { appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText });
      for (const j of r.jobPostings ?? []) if (j.title && titleLooksRelevant(j.title, kw)) paths.set(j.externalPath, j.title);
      if ((page + 1) * PAGE >= r.total) break;
    }
  }

  const details = await pMap([...paths.keys()], 3, async (path) => {
    try {
      return (await getJson<DetailResponse>(`${api}${path}`)).jobPostingInfo;
    } catch {
      return null;
    }
  });

  return details
    .filter((d): d is DetailResponse["jobPostingInfo"] => !!d)
    .map((d) => ({
      source: "workday",
      sourceKind: "ats",
      url: d.externalUrl,
      title: d.title,
      company: company.name,
      location: [d.location, ...(d.additionalLocations ?? [])].filter(Boolean).join("; "),
      workplace: workplace(d.remoteType),
      postedAt: d.startDate ?? null,
      description: d.jobDescription ?? "",
    }));
}
