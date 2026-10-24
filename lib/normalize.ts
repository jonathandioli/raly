import { createHash } from "node:crypto";
import { htmlToText, normCompany, normTitle } from "./text";
import type { Posting, RawPosting, RemoteType } from "./types";

const HOURS_PER_YEAR = 2080;

function annualize(n: number | null | undefined, period: RawPosting["salaryPeriod"]): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (period === "hour" || (period == null && n < 500)) return Math.round(n * HOURS_PER_YEAR);
  if (period === "month") return Math.round(n * 12);
  return Math.round(n);
}

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?`;
const RANGE = new RegExp(`${MONEY}\\s*(?:-|–|—|to)\\s*(?:USD\\s*)?${MONEY}(\\s*(?:/|per|an|a)\\s*(?:hour|hr|year|yr|annum|annually))?`, "i");
const SINGLE = new RegExp(`${MONEY}(\\s*(?:/|per|an|a)\\s*(?:hour|hr|year|yr|annum))?`, "i");

const toNumber = (digits: string, k?: string) => Number(digits.replace(/,/g, "")) * (k ? 1000 : 1);

/** Pull a USD salary range out of free text, annualized. Returns null when nothing plausible is found. */
export function parseSalary(text: string): { min: number; max: number } | null {
  const plausible = (n: number) => n >= 20_000 && n <= 1_000_000;
  const m = text.match(RANGE);
  if (m) {
    const hourly = /hour|hr/i.test(m[5] ?? "");
    let lo = toNumber(m[1], m[2]);
    let hi = toNumber(m[3], m[4] ?? m[2]);
    if (hourly || (hi < 500 && lo < 500)) {
      lo *= HOURS_PER_YEAR;
      hi *= HOURS_PER_YEAR;
    }
    if (plausible(lo) && plausible(hi) && hi >= lo) return { min: Math.round(lo), max: Math.round(hi) };
  }
  const s = text.match(SINGLE);
  if (s) {
    let n = toNumber(s[1], s[2]);
    if (/hour|hr/i.test(s[3] ?? "")) n *= HOURS_PER_YEAR;
    if (plausible(n)) return { min: Math.round(n), max: Math.round(n) };
  }
  return null;
}

// Phrases specific enough that a description saying them means the job itself is remote.
const REMOTE_IN_BODY = /\b(fully remote|100% remote|remote[- ]first|remote position|remote role|this role is remote|work remotely from anywhere in the us|remote within the (us|united states))\b/i;

export function detectRemote(raw: Pick<RawPosting, "workplace" | "location" | "title">, descriptionText = ""): RemoteType {
  const w = (raw.workplace ?? "").toLowerCase();
  if (w.includes("hybrid")) return "hybrid";
  if (w.includes("remote")) return "remote";
  if (w.includes("onsite") || w.includes("on-site") || w.includes("in office")) return "onsite";
  const text = `${raw.location} ${raw.title}`.toLowerCase();
  if (text.includes("hybrid")) return "hybrid";
  if (/remote|work from home|wfh|anywhere/.test(text)) return "remote";
  if (REMOTE_IN_BODY.test(descriptionText)) return "remote";
  return raw.location ? "onsite" : "unknown";
}

function toDate(v: RawPosting["postedAt"]): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function locationKey(location: string, remote: RemoteType): string {
  if (remote === "remote") return "remote";
  return location.toLowerCase().split(/[,;(]/)[0].replace(/[^a-z ]/g, "").trim();
}

export function dedupeKeyFor(company: string, title: string, location: string, remote: RemoteType): string {
  return `${normCompany(company)}|${normTitle(title)}|${locationKey(location, remote)}`;
}

export const idFor = (dedupeKey: string) => createHash("sha1").update(dedupeKey).digest("hex").slice(0, 12);

/** Stage 2: map a raw posting to the shared schema. */
export function normalize(raw: RawPosting, fetchedAt = new Date()): Posting {
  const descriptionText = htmlToText(raw.description ?? "");
  const remoteType = detectRemote(raw, descriptionText);
  const currency = raw.salaryCurrency?.toUpperCase() ?? null;
  let salaryMin = annualize(raw.salaryMin, raw.salaryPeriod ?? null);
  let salaryMax = annualize(raw.salaryMax, raw.salaryPeriod ?? null);
  let salaryCurrency = salaryMin || salaryMax ? (currency ?? "USD") : null;
  if (!salaryMin && !salaryMax) {
    const parsed = parseSalary(descriptionText);
    if (parsed) {
      salaryMin = parsed.min;
      salaryMax = parsed.max;
      salaryCurrency = "USD";
    }
  }
  if (salaryMin && !salaryMax) salaryMax = salaryMin;
  if (salaryMax && !salaryMin) salaryMin = salaryMax;

  const title = raw.title.replace(/\s+/g, " ").trim();
  const company = raw.company.replace(/\s+/g, " ").trim();
  const location = raw.location.replace(/\s+/g, " ").trim();
  const dedupeKey = dedupeKeyFor(company, title, location, remoteType);
  return {
    id: idFor(dedupeKey),
    source: raw.source,
    sources: [raw.source],
    sourceKind: raw.sourceKind,
    url: raw.url,
    title,
    company,
    location,
    remoteType,
    salaryMin,
    salaryMax,
    salaryCurrency,
    postedAt: toDate(raw.postedAt),
    descriptionText,
    fetchedAt,
    dedupeKey,
  };
}
