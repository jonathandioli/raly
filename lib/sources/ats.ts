/** A company on a token-addressed board (Greenhouse, Lever, Ashby). */
type BoardCompany = { name: string; token: string };
import { getJson } from "../http";
import type { RawPosting } from "../types";

// Public job-board APIs. No keys; each call returns every open role at one company.

interface GreenhouseJob {
  title: string;
  absolute_url: string;
  location?: { name?: string };
  updated_at?: string;
  first_published?: string;
  content?: string;
}

export async function fetchGreenhouse(c: BoardCompany): Promise<RawPosting[]> {
  const data = await getJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.token)}/jobs?content=true`,
  );
  return data.jobs.map((j) => ({
    source: "greenhouse",
    sourceKind: "ats",
    url: j.absolute_url,
    title: j.title,
    company: c.name,
    location: j.location?.name ?? "",
    postedAt: j.first_published ?? j.updated_at ?? null,
    description: j.content ?? "",
  }));
}

interface LeverJob {
  text: string;
  hostedUrl: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[] };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

export async function fetchLever(c: BoardCompany): Promise<RawPosting[]> {
  const jobs = await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(c.token)}?mode=json`);
  return jobs.map((j) => ({
    source: "lever",
    sourceKind: "ats",
    url: j.hostedUrl,
    title: j.text,
    company: c.name,
    location: j.categories?.location ?? j.categories?.allLocations?.join("; ") ?? "",
    workplace: j.workplaceType ?? null,
    salaryMin: j.salaryRange?.min ?? null,
    salaryMax: j.salaryRange?.max ?? null,
    salaryCurrency: j.salaryRange?.currency ?? null,
    salaryPeriod: leverInterval(j.salaryRange?.interval),
    postedAt: j.createdAt ?? null,
    description: [
      j.descriptionPlain ?? "",
      ...(j.lists ?? []).map((l) => `${l.text}\n${l.content}`),
      j.additionalPlain ?? "",
    ].join("\n\n"),
  }));
}

function leverInterval(i?: string): RawPosting["salaryPeriod"] {
  if (!i) return null;
  if (i.includes("hour")) return "hour";
  if (i.includes("month")) return "month";
  return "year";
}

interface AshbyJob {
  title: string;
  location?: string;
  isRemote?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  jobUrl: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  isListed?: boolean;
  compensation?: {
    summaryComponents?: { compensationType?: string; interval?: string; currencyCode?: string; minValue?: number; maxValue?: number }[];
  };
}

export async function fetchAshby(c: BoardCompany): Promise<RawPosting[]> {
  const data = await getJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.token)}?includeCompensation=true`,
  );
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const salary = j.compensation?.summaryComponents?.find((s) => s.compensationType === "Salary");
      return {
        source: "ashby",
        sourceKind: "ats" as const,
        url: j.jobUrl,
        title: j.title,
        company: c.name,
        location: j.location ?? "",
        workplace: j.workplaceType ?? (j.isRemote ? "remote" : null),
        salaryMin: salary?.minValue ?? null,
        salaryMax: salary?.maxValue ?? null,
        salaryCurrency: salary?.currencyCode ?? null,
        salaryPeriod: salary?.interval?.toLowerCase().includes("hour") ? ("hour" as const) : ("year" as const),
        postedAt: j.publishedAt ?? null,
        description: j.descriptionPlain ?? j.descriptionHtml ?? "",
      };
    });
}
