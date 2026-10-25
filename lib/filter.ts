import type { Config } from "./config";
import { excludedHits, prefilter } from "./prefilter";
import { hasPhrase, normCompany, normTitle, titleTokens } from "./text";
import type { Posting } from "./types";

/** True when every word of one of the target titles appears in the title, in any order. */
export function matchesTargetTitle(title: string, profile: Config["profile"]): boolean {
  const tokens = titleTokens(title);
  return profile.title_keywords.some((kw) => [...titleTokens(kw)].every((t) => tokens.has(t)));
}

const NON_US = [
  "canada", "toronto", "vancouver", "montreal", "uk", "united kingdom", "england", "london", "ireland", "dublin",
  "germany", "berlin", "munich", "france", "paris", "spain", "madrid", "barcelona", "netherlands", "amsterdam",
  "poland", "warsaw", "portugal", "lisbon", "india", "bangalore", "bengaluru", "hyderabad", "pune", "singapore",
  "australia", "sydney", "melbourne", "japan", "tokyo", "mexico", "brazil", "argentina", "colombia", "philippines",
  "israel", "tel aviv", "emea", "apac", "latam", "europe", "asia", "international",
];

export function isNonUs(location: string): boolean {
  const norm = normTitle(location);
  if (/\b(us|usa|united states)\b/.test(norm)) return false;
  return NON_US.some((c) => hasPhrase(norm, c));
}

const STATE_NAMES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois",
  in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
  nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah",
  vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

/**
 * "Manchester, NH" matches a location segment naming both Manchester and New Hampshire/NH,
 * so it doesn't pick up Manchester UK or CT. An entry without a state is a plain substring.
 */
export function inMetro(location: string, metros: string[]): boolean {
  const segments = location.split(/;|\n|\|/).map((s) => normTitle(s));
  return metros.some((m) => {
    const [city, st] = m.split(",").map((x) => x.trim());
    if (!st) return location.toLowerCase().includes(m.toLowerCase());
    const abbr = st.toLowerCase();
    return segments.some((seg) => hasPhrase(seg, city) && (hasPhrase(seg, abbr) || hasPhrase(seg, STATE_NAMES[abbr] ?? abbr)));
  });
}

export function locationOk(p: Pick<Posting, "location" | "remoteType">, loc: Config["profile"]["locations"]): boolean {
  if (isNonUs(p.location)) return false;
  if (inMetro(p.location, loc.metros)) return true;
  return loc.remote_us && p.remoteType === "remote";
}

export type RejectReason = "title" | "excluded_title" | "blocklist" | "age" | "location";

/** Stage 4: hard rules. Returns the reason a posting is rejected, or null if it passes. */
export function rejectReason(p: Posting, config: Config, now = new Date()): RejectReason | null {
  const profile = config.profile;
  const norm = normTitle(p.title);
  if (excludedHits(norm, config.keywords).length) return "excluded_title";
  if (!prefilter(p, config.keywords).pass) return "title";
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
