import { getJson, pMap } from "../http";
import { titleLooksRelevant } from "../prefilter";
import type { RawPosting } from "../types";

// Eightfold career sites (e.g. https://searchjobs.libertymutualgroup.com/careers) answer a public
// /api/apply/v2 API, which their robots.txt explicitly allows. Search is loose and returns 10 per
// page, so: page through a few newest-first searches, screen titles, fetch full details.

const SEARCHES = ["learning", "training", "talent development", "university", "early careers", "onboarding"];
const PAGES = 3;
const PER_PAGE = 10; // the API's maximum

interface Position {
  id: number | string;
  name: string;
  location?: string;
  locations?: string[];
  t_create?: number;
  work_location_option?: string;
  job_description?: string;
  canonicalPositionUrl?: string;
}

function workplace(option?: string): string | null {
  if (!option) return null;
  if (option.startsWith("remote")) return "remote";
  if (option.includes("hybrid")) return "hybrid";
  return "onsite";
}

/** The careers URL plus the Eightfold tenant domain, e.g. "libertymutual.com" (from robots.txt / the sitemap). */
export async function fetchEightfold(company: { name: string; url: string; domain: string }): Promise<RawPosting[]> {
  const origin = new URL(company.url).origin;
  const api = `${origin}/api/apply/v2/jobs`;

  const ids = new Set<string>();
  for (const query of SEARCHES) {
    for (let page = 0; page < PAGES; page++) {
      const params = new URLSearchParams({ domain: company.domain, query, start: String(page * PER_PAGE), num: String(PER_PAGE), sort_by: "timestamp" });
      const r = await getJson<{ count: number; positions: Position[] }>(`${api}?${params}`);
      for (const p of r.positions ?? []) if (p.name && titleLooksRelevant(p.name)) ids.add(String(p.id));
      if ((page + 1) * PER_PAGE >= r.count) break;
    }
  }

  const details = await pMap([...ids], 3, async (id) => {
    try {
      return await getJson<Position>(`${api}/${id}?domain=${encodeURIComponent(company.domain)}`);
    } catch {
      return null;
    }
  });

  return details
    .filter((d): d is Position => !!d)
    .map((d) => ({
      source: "eightfold",
      sourceKind: "ats",
      url: d.canonicalPositionUrl ?? `${origin}/careers/job/${d.id}`,
      title: d.name,
      company: company.name,
      location: (d.locations?.length ? d.locations : [d.location ?? ""]).join("; ").replace(/, United States/g, ""),
      workplace: workplace(d.work_location_option),
      postedAt: d.t_create ? new Date(d.t_create * 1000) : null,
      description: d.job_description ?? "",
    }));
}
