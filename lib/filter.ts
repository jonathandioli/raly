import type { Config } from "./config";
import { prefilter } from "./prefilter";
import { hasPhrase, normCompany, normTitle, titleTokens } from "./text";
import type { Posting } from "./types";

export type TitleMatch = "exact" | "adjacent" | "domain" | null;

/** How a title relates to the target titles. Exact = every word of a target keyword present, any order. */
export function matchTitle(title: string, profile: Config["profile"]): TitleMatch {
  const tokens = titleTokens(title);
  const containsAll = (kw: string) => [...titleTokens(kw)].every((t) => tokens.has(t));
  if (profile.title_keywords.some(containsAll)) return "exact";
  if (profile.adjacent_title_keywords.some(containsAll)) return "adjacent";
  const norm = normTitle(title);
  if (profile.domain_terms.some((d) => hasPhrase(norm, d))) return "domain";
  return null;
}

const NON_US = [
  "canada", "toronto", "vancouver", "montreal", "uk", "united kingdom", "england", "london", "ireland", "dublin",
  "germany", "berlin", "munich", "france", "paris", "spain", "madrid", "barcelona", "netherlands", "amsterdam",
  "poland", "warsaw", "portugal", "lisbon", "india", "bangalore", "bengaluru", "hyderabad", "pune", "singapore",
  "australia", "sydney", "melbourne", "japan", "tokyo", "mexico", "brazil", "argentina", "colombia", "philippines",
  "israel", "tel aviv", "emea", "apac", "latam", "europe", "asia",
];

export function isNonUs(location: string): boolean {
  const norm = normTitle(location);
  if (/\b(us|usa|united states)\b/.test(norm)) return false;
  return NON_US.some((c) => hasPhrase(norm, c));
}

export function locationOk(p: Pick<Posting, "location" | "remoteType">, loc: Config["profile"]["locations"]): boolean {
  if (isNonUs(p.location)) return false;
  const inMetro = loc.metros.some((m) => p.location.toLowerCase().includes(m.toLowerCase()));
  if (inMetro) return true;
  return loc.remote_us && p.remoteType === "remote";
}

export type RejectReason = "title" | "excluded_title" | "blocklist" | "age" | "location";

/** Stage 4: hard rules. Returns the reason a posting is rejected, or null if it passes. */
export function rejectReason(p: Posting, config: Config, now = new Date()): RejectReason | null {
  const profile = config.profile;
  const norm = normTitle(p.title);
  if (profile.excluded_titles.some((x) => hasPhrase(norm, x))) return "excluded_title";
  // The deterministic L&D screen (title + description vocabulary, manager+ level) decides relevance.
  if (!prefilter(p).pass) return "title";
  const company = normCompany(p.company);
  if (profile.company_blocklist.some((b) => normCompany(b) === company)) return "blocklist";
  const posted = p.postedAt ?? p.fetchedAt;
  if (now.getTime() - posted.getTime() > profile.posted_within_days * 86_400_000) return "age";
  if (!locationOk(p, profile.locations)) return "location";
  return null;
}

export function applyFilters(postings: Posting[], config: Config, now = new Date()) {
  const kept: Posting[] = [];
  const rejected: Record<RejectReason, number> = { title: 0, excluded_title: 0, blocklist: 0, age: 0, location: 0 };
  for (const p of postings) {
    const r = rejectReason(p, config, now);
    if (r) rejected[r]++;
    else kept.push(p);
  }
  return { kept, rejected };
}
