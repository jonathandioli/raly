import { USER_AGENT, pMap } from "../http";
import { titleLooksRelevant } from "../prefilter";
import type { Keywords } from "../config";
import type { RawPosting } from "../types";
import { parseJobPage } from "./sitemap";

// KPMG US runs its own job search (kpmguscareers.com): server-rendered result cards with a
// keyword filter, and job pages carrying schema.org JobPosting data.

const ORIGIN = "https://www.kpmguscareers.com";
const PAGES = 1;

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Result cards list category, title, location count, then the title again; the repeated text is the title. */
export function parseKpmgCards(html: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const m of html.matchAll(/<a href="\/jobdetail\/\?jobId=(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const parts = m[2].split(/<[^>]+>/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const title = parts.find((p, i) => parts.indexOf(p) !== i) ?? parts[2] ?? "";
    if (title) out.push({ id: m[1], title });
  }
  return out;
}

export async function fetchKpmg(company: { name: string }, kw: Keywords): Promise<RawPosting[]> {
  const jobs = new Map<string, string>();
  for (const keyword of kw.search_terms) {
    for (let page = 1; page <= PAGES; page++) {
      const html = await getText(`${ORIGIN}/job-search/?keyword=${encodeURIComponent(keyword)}&spage=${page}`);
      if (!html) break;
      const cards = parseKpmgCards(html);
      for (const c of cards) if (titleLooksRelevant(c.title, kw)) jobs.set(c.id, c.title);
      if (!cards.length) break;
    }
  }

  const pages = await pMap([...jobs.keys()], 3, async (id) => {
    const url = `${ORIGIN}/jobdetail/?jobId=${id}`;
    const html = await getText(url);
    const job = html ? parseJobPage(html) : null;
    return job ? { ...job, url } : null;
  });

  return pages
    .filter((p): p is NonNullable<typeof p> => !!p && !!p.title)
    .map((p) => ({ ...p, source: "kpmg", sourceKind: "ats" as const, company: company.name }));
}
