import { type Keywords, loadProfile } from "./config";
import { hasPhrase, normTitle } from "./text";
import type { Posting } from "./types";

// Deterministic screen over every fetched posting for the two target role families:
// L&D / talent development, and early talent (university relations, internship and co-op
// programs, new-hire experience). The word lists live in config.yaml under `keywords` and can
// be overridden from the dashboard's Keywords page.

let defaults: Keywords | null = null;
/** config.yaml's lists, for callers (and tests) that don't pass the run's effective lists. */
export const defaultKeywords = (): Keywords => (defaults ??= loadProfile().config.keywords);

/** Early-talent phrases in a normalized title. */
export const earlyTalentPhrases = (normalizedTitle: string, kw: Keywords = defaultKeywords()) =>
  kw.early_talent_titles.filter((t) => hasPhrase(normalizedTitle, t));

/**
 * Excluded words in a normalized title. In a title that names an early-talent program, words
 * that belong to early-talent phrases ("internship", "recruiting", "student") don't count, so
 * "Senior Manager, Internship & Co-op Programs" survives while "Finance Intern" doesn't.
 */
export function excludedHits(normalizedTitle: string, kw: Keywords = defaultKeywords()): string[] {
  const program = earlyTalentPhrases(normalizedTitle, kw).length > 0;
  const programWord = (x: string) => kw.early_talent_titles.some((ph) => hasPhrase(normTitle(ph), x));
  return kw.exclude_titles.filter((x) => hasPhrase(normalizedTitle, x) && !(program && programWord(x)));
}

export interface PrefilterResult {
  pass: boolean;
  score: number; // 0-100, only for ordering
  titleDomain: string[];
  bodyHits: string[];
  reason: string;
}

const senior = (title: string, kw: Keywords) => kw.seniority.some((s) => hasPhrase(title, s));

/** Title-only version of the screen, for sources where fetching a description costs a request. */
export function titleLooksRelevant(rawTitle: string, kw: Keywords = defaultKeywords()): boolean {
  const title = normTitle(rawTitle);
  if (excludedHits(title, kw).length || !senior(title, kw)) return false;
  if (earlyTalentPhrases(title, kw).length) return true;
  return [...kw.strong_titles, ...kw.soft_titles].some((t) => hasPhrase(title, t));
}

export function prefilter(p: Pick<Posting, "title" | "descriptionText">, kw: Keywords = defaultKeywords()): PrefilterResult {
  const title = normTitle(p.title);
  const body = ` ${normTitle(p.descriptionText)} `;
  const strong = kw.strong_titles.filter((t) => hasPhrase(title, t));
  const titleDomain = [...strong, ...kw.soft_titles.filter((t) => hasPhrase(title, t))];
  const isSenior = senior(title, kw);
  // Word-start match, so "facilitat" catches facilitate/facilitation and "lms" doesn't hit "films".
  const bodyHits = kw.description_terms.filter((t) => body.includes(` ${normTitle(t)}`));

  const score = Math.min(100, titleDomain.length * 25 + bodyHits.length * 6 + (isSenior ? 15 : 0));
  const result = (pass: boolean, reason: string): PrefilterResult => ({ pass, score, titleDomain, bodyHits, reason });

  const excluded = excludedHits(title, kw);
  if (excluded.length) return result(false, `title: ${excluded[0]}`);
  // Early-talent program roles at manager+ level.
  if (earlyTalentPhrases(title, kw).length) return isSenior ? result(true, "early talent title") : result(false, "not manager+");
  if (strong.length && isSenior) return result(true, "L&D title");
  // Softer title words need the description to back them up.
  if (titleDomain.length && isSenior && bodyHits.length >= 1) return result(true, "L&D-ish title");
  // Odd title, but the description is unmistakably L&D work.
  if (isSenior && bodyHits.length >= 5) return result(true, "L&D description");
  if (titleDomain.length && !isSenior) return result(false, "not manager+");
  if (titleDomain.length) return result(false, "no L&D in description");
  return result(false, "no L&D signal");
}
