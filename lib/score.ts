import type { Config } from "./config";
import { matchTitle } from "./filter";
import { normCompany, normTitle, ratio } from "./text";
import type { Posting, ScoredPosting, SemanticResult } from "./types";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function titlePoints(title: string, config: Config): number {
  const m = matchTitle(title, config.profile);
  const w = config.weights.title;
  return m === "exact" ? w : m ? w / 2 : 0;
}

export function salaryPoints(p: Pick<Posting, "salaryMin" | "salaryMax" | "salaryCurrency">, config: Config): number {
  const s = config.profile.salary;
  const w = config.weights.salary;
  if (!p.salaryMin || !p.salaryMax || (p.salaryCurrency && p.salaryCurrency !== "USD")) return Math.min(10, w);
  const overlaps = (lo: number, hi: number) => p.salaryMax! >= lo && p.salaryMin! <= hi;
  if (p.salaryMax < s.floor) return 0;
  if (overlaps(s.sweet_min, s.sweet_max)) return w;
  if (overlaps(s.min, s.max)) return w * 0.6;
  // Listed, above the floor, but outside the band (e.g. a $120-128k range).
  return w * 0.25;
}

export function skillsPoints(description: string, config: Config): number {
  const skills = config.profile.skills;
  if (!skills.length) return 0;
  const text = ` ${normTitle(description)} `;
  const found = skills.filter((s) => text.includes(` ${normTitle(s)} `)).length;
  return config.weights.skills * (found / skills.length);
}

export function freshnessPoints(p: Pick<Posting, "postedAt" | "fetchedAt" | "sourceKind">, config: Config, now = new Date()): number {
  const w = config.weights.freshness;
  const ageDays = (now.getTime() - (p.postedAt ?? p.fetchedAt).getTime()) / 86_400_000;
  const window = config.profile.posted_within_days;
  // 70% of the weight is age (full at <= 3 days, fading to 0 at the window), 30% is a direct ATS link.
  const age = ageDays <= 3 ? 1 : clamp01(1 - (ageDays - 3) / Math.max(1, window - 3));
  return w * (0.7 * age + 0.3 * (p.sourceKind === "ats" ? 1 : 0.3));
}

export interface SkippedRole {
  company: string;
  title: string;
}

export function skipPenalty(p: Pick<Posting, "company" | "title">, skipped: SkippedRole[], config: Config): number {
  const company = normCompany(p.company);
  const title = normTitle(p.title);
  const near = skipped.some((s) => normCompany(s.company) === company && ratio(normTitle(s.title), title) >= 85);
  return near ? config.penalties.skipped_near_duplicate : 0;
}

/** Stage 5: combine the rule-based parts with the LLM's 0-10 semantic fit. */
export function scorePosting(
  p: Posting,
  semantic: SemanticResult | null,
  config: Config,
  skipped: SkippedRole[] = [],
  now = new Date(),
): ScoredPosting {
  // Without an LLM verdict (no API key, or over the per-run call cap) semantic fit is scored as neutral.
  const semanticPts = config.weights.semantic * (semantic ? clamp01(semantic.score / 10) : 0.5);
  const parts = {
    semantic: semanticPts,
    title: titlePoints(p.title, config),
    salary: salaryPoints(p, config),
    skills: skillsPoints(p.descriptionText, config),
    freshness: freshnessPoints(p, config, now),
    penalty: skipPenalty(p, skipped, config),
  };
  const total = parts.semantic + parts.title + parts.salary + parts.skills + parts.freshness - parts.penalty;
  const max = Object.values(config.weights).reduce((a, b) => a + b, 0) || 100;
  return { ...p, parts, semantic, score: Math.round(clamp01(total / max) * 100) };
}
