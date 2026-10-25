import { USER_AGENT, pMap } from "../http";
import { titleLooksRelevant } from "../prefilter";
import type { RawPosting } from "../types";
import { withCountry } from "./oracle";

// Career sites without a JSON API (SAP SuccessFactors Career Site Builder, Avature, Phenom…)
// still publish a sitemap for search engines, and each job page carries schema.org JobPosting
// data for Google for Jobs. So: read robots.txt, read the sitemap, screen titles from the
// listing, and parse JobPosting data from the few pages that look relevant.

const MAX_CHILD_SITEMAPS = 10;
const MAX_PAGES = 30;

interface Robots {
  disallow: string[];
  sitemaps: string[];
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export function parseRobots(text: string): Robots {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(key)) applies = value === "*";
    else if (/^disallow$/i.test(key) && applies && value) disallow.push(value);
    else if (/^sitemap$/i.test(key) && value) sitemaps.push(value);
  }
  return { disallow, sitemaps };
}

const allowed = (url: string, robots: Robots) => !robots.disallow.some((d) => new URL(url).pathname.startsWith(d));

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** A readable title guess from a job URL slug: /job/Boston-Senior-Manager-Learning/123/ -> "Boston Senior Manager Learning". */
export function titleFromUrl(url: string): string {
  const parts = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);
  const words = parts.filter((p) => /[a-z]/i.test(p) && !/^(job|jobs|en|us|en-us|global|careers?)$/i.test(p));
  return words.join(" ").replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
}

interface Listing {
  url: string;
  title: string;
}

/** Job URLs (with a title guess) from a sitemap, a sitemap index, or an RSS-style job feed. */
export async function listJobs(base: string, robots: Robots): Promise<Listing[]> {
  const roots = robots.sitemaps.length ? robots.sitemaps : [`${base}/sitemap.xml`];
  const out = new Map<string, string>();
  const queue = [...roots];
  let children = 0;
  while (queue.length) {
    const url = queue.shift()!;
    const xml = await getText(url);
    if (!xml) continue;
    // RSS-style feed (e.g. Boston Scientific): titles come with it.
    for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const link = item[1].match(/<link>([\s\S]*?)<\/link>/)?.[1];
      const title = item[1].match(/<title>([\s\S]*?)<\/title>/)?.[1];
      if (link && title) out.set(decode(link), decode(title));
    }
    if (/<sitemapindex/i.test(xml)) {
      const kids = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => decode(m[1]));
      // Prefer child sitemaps that look like job listings.
      kids.sort((a, b) => Number(/job/i.test(b)) - Number(/job/i.test(a)));
      for (const k of kids) if (children++ < MAX_CHILD_SITEMAPS) queue.push(k);
      continue;
    }
    for (const m of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)) {
      const loc = decode(m[1]);
      if (/\/jobs?\//i.test(loc) && !out.has(loc)) out.set(loc, titleFromUrl(loc));
    }
  }
  return [...out].map(([url, title]) => ({ url, title }));
}

type JsonLd = Record<string, unknown>;

function findJobPosting(node: unknown): JsonLd | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(findJobPosting).find(Boolean) ?? null;
  const obj = node as JsonLd;
  const type = obj["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return obj;
  return findJobPosting(obj["@graph"]);
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function placeText(loc: unknown): { text: string; country: string } {
  const places = Array.isArray(loc) ? loc : loc ? [loc] : [];
  const parts: string[] = [];
  let country = "";
  for (const p of places as JsonLd[]) {
    const a = (p?.address ?? {}) as JsonLd;
    const c = typeof a.addressCountry === "object" ? str((a.addressCountry as JsonLd).name) : str(a.addressCountry);
    country ||= c;
    parts.push([str(a.addressLocality), str(a.addressRegion)].filter(Boolean).join(", "));
  }
  return { text: parts.filter(Boolean).join("; "), country };
}

const US = /^(us|usa|united states( of america)?)$/i;

/** schema.org JobPosting from JSON-LD, falling back to the microdata SuccessFactors pages use. */
export function parseJobPage(html: string): Omit<RawPosting, "source" | "sourceKind" | "url" | "company"> | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const jp = findJobPosting(data);
    if (!jp) continue;
    const { text, country } = placeText(jp.jobLocation);
    const salary = (jp.baseSalary as JsonLd | undefined)?.value as JsonLd | undefined;
    const unit = str(salary?.unitText).toLowerCase();
    return {
      title: decode(str(jp.title)),
      location: withCountry(text || (jp.jobLocationType === "TELECOMMUTE" ? "Remote" : ""), country && !US.test(country) ? country : null),
      workplace: jp.jobLocationType === "TELECOMMUTE" ? "remote" : null,
      salaryMin: Number(salary?.minValue) || null,
      salaryMax: Number(salary?.maxValue) || null,
      salaryCurrency: str((jp.baseSalary as JsonLd | undefined)?.currency) || null,
      salaryPeriod: unit.includes("hour") ? "hour" : unit.includes("month") ? "month" : unit ? "year" : null,
      postedAt: str(jp.datePosted) || null,
      description: str(jp.description),
    };
  }
  // SuccessFactors Career Site Builder microdata.
  const meta = (prop: string) => html.match(new RegExp(`itemprop="${prop}"[^>]*content="([^"]*)"`))?.[1] ?? "";
  const title = html.match(/data-careersite-propertyid="title"[^>]*>([\s\S]*?)<\//)?.[1];
  if (!title) return null;
  const description = html.match(/data-careersite-propertyid="description"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/)?.[1] ?? "";
  const country = meta("addressCountry");
  return {
    title: decode(title.replace(/<[^>]+>/g, "")),
    location: withCountry([meta("addressLocality"), meta("addressRegion")].filter(Boolean).join(", "), country && !US.test(country) ? country : null),
    postedAt: meta("datePosted") || null,
    description,
  };
}

/** "Marlborough, MA, US" -> "Marlborough, MA"; "Clonmel, TA, IE" -> "Clonmel, TA, International (IE)". */
function listingLocation(text?: string): string {
  if (!text) return "";
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts.at(-1) ?? "";
  if (/^[A-Z]{2}$/.test(last) && parts.length >= 2) return withCountry(parts.slice(0, -1).join(", "), last === "US" ? null : last);
  return text;
}

export async function fetchSitemap(company: { name: string; url: string }): Promise<RawPosting[]> {
  const base = new URL(company.url).origin;
  const robots = parseRobots((await getText(`${base}/robots.txt`)) ?? "");
  const listings = (await listJobs(base, robots)).filter((l) => allowed(l.url, robots) && titleLooksRelevant(l.title));
  if (listings.length > MAX_PAGES) listings.length = MAX_PAGES;

  const pages = await pMap(listings, 3, async (l) => {
    const html = await getText(l.url);
    const job = html ? parseJobPage(html) : null;
    if (!job) return null;
    // Feeds like Boston Scientific's put the location in the listing title: "Sr Manager, L&D (Marlborough, MA, US)".
    const fromListing = l.title.match(/\(([^()]+)\)\s*$/)?.[1];
    return { ...job, url: l.url, location: job.location || listingLocation(fromListing) };
  });

  return pages
    .filter((p): p is NonNullable<typeof p> => !!p && !!p.title)
    .map((p) => ({ ...p, source: "careersite", sourceKind: "ats" as const, company: company.name }));
}
