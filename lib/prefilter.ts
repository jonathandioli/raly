import { hasPhrase, normTitle } from "./text";
import type { Posting } from "./types";

// Deterministic stage 1: a recall-oriented L&D screen over every fetched posting.
// It decides only "worth an LLM read or not"; ranking happens later.

/** Title words that put a role in L&D / people-development territory. */
const TITLE_DOMAIN = [
  "learning", "learning and development", "learning development", "training", "talent development",
  "leadership development", "people development", "organizational development", "organisational development",
  "organizational effectiveness", "instructional", "instructional design", "curriculum", "education",
  "academy", "university", "coaching", "workforce capability", "people capability", "upskilling", "reskilling",
  "talent management", "people programs", "employee development", "employee experience", "onboarding",
  "facilitation", "knowledge management", "talent experience",
];

/** Title words that mean the "learning"/"training"/"enablement" is something else. */
const TITLE_NOT_LD = [
  "engineer", "engineering", "developer", "machine learning", "deep learning", "ml", "ai", "scientist", "research",
  "post training", "pre training", "model training", "training runtime", "inference", "data", "infrastructure",
  "customer enablement", "partner enablement", "technical enablement", "product enablement", "field enablement",
  "customer education", "customer success", "customer", "support", "account executive", "account manager",
  "sales engineer", "solutions", "recruiter", "recruiting", "sourcing", "intern", "internship", "physician",
  "nurse", "clinical", "teacher", "tutor", "professor", "student",
  // Sales/GTM enablement trains revenue teams; out of scope for an L&D/talent search.
  "sales", "gtm", "go to market", "revenue", "field", "partner", "partnerships", "commercial",
  "product manager", "product designer", "marketing", "content", "generalist", "quality",
  // Retail "manager in training" programs are trainee roles, not L&D.
  "in training", "trainee", "store", "assistant store manager",
  // Clinical and patient education is a healthcare specialty, not corporate L&D.
  "pediatric", "surgery", "surgical", "vascular", "endovascular", "gi", "nursing", "patient", "medical", "clinical education",
];

const SENIORITY = ["manager", "senior manager", "director", "associate director", "senior director", "head", "lead", "leader", "principal", "business partner"];

/** Title words specific enough to pass at manager+ level even when the description skips the jargon. */
const STRONG_TITLE = [
  "learning", "learning and development", "learning development", "talent development", "leadership development",
  "people development", "organizational development", "organisational development", "instructional design",
  "curriculum", "talent management", "talent experience", "training", "coaching", "upskilling", "employee development",
];

/** Description phrases that only show up in genuine L&D roles. */
const BODY_TERMS = [
  "lms", "learning management system", "instructional design", "addie", "kirkpatrick", "needs analysis",
  "needs assessment", "learning strategy", "learning programs", "leadership development", "facilitat",
  "curriculum", "e learning", "elearning", "articulate", "storyline", "rise 360", "cornerstone", "workday learning",
  "degreed", "docebo", "360learning", "onboarding program", "competency", "upskill", "reskill", "talent development",
  "learning experience", "70 20 10", "train the trainer", "manager development", "learning and development",
  "learning culture", "career development", "succession", "coaching program", "learning technology",
];

export interface PrefilterResult {
  pass: boolean;
  score: number; // 0-100, only for ordering
  titleDomain: string[];
  bodyHits: string[];
  reason: string;
}

/** Title-only version of the screen, for sources where fetching a description costs a request. */
export function titleLooksRelevant(rawTitle: string): boolean {
  const title = normTitle(rawTitle);
  if (TITLE_NOT_LD.some((t) => hasPhrase(title, t))) return false;
  return TITLE_DOMAIN.some((t) => hasPhrase(title, t)) && SENIORITY.some((s) => hasPhrase(title, s));
}

export function prefilter(p: Pick<Posting, "title" | "descriptionText">): PrefilterResult {
  const title = normTitle(p.title);
  const body = ` ${normTitle(p.descriptionText)} `;
  const titleDomain = TITLE_DOMAIN.filter((t) => hasPhrase(title, t));
  const notLd = TITLE_NOT_LD.filter((t) => hasPhrase(title, t));
  const senior = SENIORITY.some((s) => hasPhrase(title, s));
  // Word-start match, so "facilitat" catches facilitate/facilitation and "lms" doesn't hit "films".
  const bodyHits = BODY_TERMS.filter((t) => body.includes(` ${normTitle(t)}`));

  const score = Math.min(100, titleDomain.length * 25 + bodyHits.length * 6 + (senior ? 15 : 0));
  const result = (pass: boolean, reason: string): PrefilterResult => ({ pass, score, titleDomain, bodyHits, reason });

  if (notLd.length) return result(false, `title: ${notLd[0]}`);
  // Clear L&D title at manager+ level.
  const strong = STRONG_TITLE.some((t) => hasPhrase(title, t));
  if (strong && senior) return result(true, "L&D title");
  // Softer title words (onboarding, education, capability…) need the description to back them up.
  if (titleDomain.length && senior && bodyHits.length >= 1) return result(true, "L&D-ish title");
  // Odd title, but the description is unmistakably L&D work.
  if (senior && bodyHits.length >= 5) return result(true, "L&D description");
  if (titleDomain.length && !senior) return result(false, "not manager+");
  if (titleDomain.length) return result(false, "no L&D in description");
  return result(false, "no L&D signal");
}
