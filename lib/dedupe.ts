import { locationKey } from "./normalize";
import { normCompany, normTitle, ratio } from "./text";
import type { Posting } from "./types";

export const TITLE_MATCH_RATIO = 90;

/** Which copy of a job to keep: the employer's own ATS link first, then the one with salary, then the fullest text. */
function rank(p: Posting): number {
  return (p.sourceKind === "ats" ? 1000 : 0) + (p.salaryMin ? 100 : 0) + Math.min(p.descriptionText.length / 1000, 50);
}

function merge(a: Posting, b: Posting): Posting {
  const [keep, other] = rank(b) > rank(a) ? [b, a] : [a, b];
  const earliest = [keep.postedAt, other.postedAt].filter((d): d is Date => !!d).sort((x, y) => +x - +y)[0] ?? null;
  return {
    ...keep,
    sources: [...new Set([...keep.sources, ...other.sources])],
    salaryMin: keep.salaryMin ?? other.salaryMin,
    salaryMax: keep.salaryMax ?? other.salaryMax,
    salaryCurrency: keep.salaryCurrency ?? other.salaryCurrency,
    postedAt: earliest,
    descriptionText: keep.descriptionText.length >= other.descriptionText.length ? keep.descriptionText : other.descriptionText,
  };
}

const bucket = (p: Posting) => `${normCompany(p.company)}|${locationKey(p.location, p.remoteType)}`;

export interface KnownPosting {
  id: string;
  company: string;
  title: string;
  location: string;
  remoteType: Posting["remoteType"];
}

/**
 * Stage 3: merge the same job seen on several sources (same company + location, titles >= 90 similar),
 * then reuse the id of a matching posting already in the database so it isn't treated as new.
 */
export function dedupe(postings: Posting[], known: KnownPosting[] = []): Posting[] {
  const groups = new Map<string, Posting[]>();
  for (const p of postings) {
    const key = bucket(p);
    const list = groups.get(key) ?? [];
    const t = normTitle(p.title);
    const i = list.findIndex((q) => ratio(normTitle(q.title), t) >= TITLE_MATCH_RATIO);
    if (i >= 0) list[i] = merge(list[i], p);
    else list.push(p);
    groups.set(key, list);
  }

  const knownByBucket = new Map<string, KnownPosting[]>();
  for (const k of known) {
    const key = `${normCompany(k.company)}|${locationKey(k.location, k.remoteType)}`;
    knownByBucket.set(key, [...(knownByBucket.get(key) ?? []), k]);
  }

  const out: Posting[] = [];
  for (const [key, list] of groups) {
    for (const p of list) {
      const t = normTitle(p.title);
      const match = knownByBucket.get(key)?.find((k) => ratio(normTitle(k.title), t) >= TITLE_MATCH_RATIO);
      out.push(match ? { ...p, id: match.id } : p);
    }
  }
  return out;
}
