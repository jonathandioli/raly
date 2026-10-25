import { getJson, pMap } from "../http";
import { titleLooksRelevant } from "../prefilter";
import type { Keywords } from "../config";
import type { RawPosting } from "../types";

// Oracle Recruiting Cloud ("Candidate Experience") sites, e.g.
// https://ejwl.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX
// serve a public REST API: keyword search (newest first), then one detail call per job.

const PER_SEARCH = 25;

export function parseOracleUrl(url: string): { origin: string; site: string } {
  const u = new URL(url);
  const site = u.pathname.match(/\/sites\/([^/]+)/)?.[1];
  if (!site) throw new Error(`Not an Oracle Candidate Experience URL: ${url}`);
  return { origin: u.origin, site };
}

interface SearchResponse {
  items: { requisitionList?: { Id: string; Title: string; PostedDate?: string; PrimaryLocation?: string; WorkplaceType?: string }[] }[];
}

interface DetailResponse {
  items: {
    Id: string;
    Title: string;
    ExternalPostedStartDate?: string;
    PrimaryLocation?: string;
    PrimaryLocationCountry?: string;
    WorkplaceType?: string;
    ExternalDescriptionStr?: string;
    ExternalResponsibilitiesStr?: string;
    ExternalQualificationsStr?: string;
  }[];
}

/** Mark non-US postings explicitly so the location filter doesn't have to know every city on earth. */
export function withCountry(location: string, countryCode?: string | null): string {
  return countryCode && countryCode.toUpperCase() !== "US" ? `${location}${location ? ", " : ""}International (${countryCode})` : location;
}

export async function fetchOracle(company: { name: string; url: string }, kw: Keywords): Promise<RawPosting[]> {
  const { origin, site } = parseOracleUrl(company.url);
  const api = `${origin}/hcmRestApi/resources/latest`;

  const ids = new Map<string, string>();
  for (const keyword of kw.search_terms) {
    const finder = `findReqs;siteNumber=${site},keyword="${keyword}",limit=${PER_SEARCH},offset=0,sortBy=POSTING_DATES_DESC`;
    const r = await getJson<SearchResponse>(`${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`);
    for (const j of r.items?.[0]?.requisitionList ?? []) if (j.Title && titleLooksRelevant(j.Title, kw)) ids.set(j.Id, j.Title);
  }

  const details = await pMap([...ids.keys()], 3, async (id) => {
    try {
      const finder = `ById;Id="${id}",siteNumber=${site}`;
      const r = await getJson<DetailResponse>(`${api}/recruitingCEJobRequisitionDetails?onlyData=true&expand=all&finder=${encodeURIComponent(finder)}`);
      return r.items?.[0] ?? null;
    } catch {
      return null;
    }
  });

  return details
    .filter((d): d is DetailResponse["items"][number] => !!d)
    .map((d) => ({
      source: "oracle",
      sourceKind: "ats",
      url: `${origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${d.Id}`,
      title: d.Title,
      company: company.name,
      location: withCountry(d.PrimaryLocation ?? "", d.PrimaryLocationCountry),
      workplace: d.WorkplaceType || null,
      postedAt: d.ExternalPostedStartDate ?? null,
      description: [d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr].filter(Boolean).join("\n\n"),
    }));
}
