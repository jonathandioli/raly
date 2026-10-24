export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";
export type SourceKind = "ats" | "aggregator";

/** What an adapter returns: as close to the source's own fields as is useful. */
export interface RawPosting {
  source: string;
  sourceKind: SourceKind;
  url: string;
  title: string;
  company: string;
  location: string;
  /** Explicit remote/hybrid/onsite signal from the API, when it has one. */
  workplace?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: "year" | "month" | "hour" | null;
  postedAt?: string | number | Date | null;
  /** HTML or plain text; normalize strips tags. */
  description: string;
}

/** The one schema every posting is mapped to. */
export interface Posting {
  id: string;
  source: string;
  sources: string[];
  sourceKind: SourceKind;
  url: string;
  title: string;
  company: string;
  location: string;
  remoteType: RemoteType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: Date | null;
  descriptionText: string;
  fetchedAt: Date;
  dedupeKey: string;
}

export interface SemanticResult {
  score: number; // 0-10
  reason: string;
  red_flags: string[];
}

export interface ScoredPosting extends Posting {
  score: number;
  parts: { semantic: number; title: number; salary: number; skills: number; freshness: number; penalty: number };
  semantic: SemanticResult | null;
}

export type MarkStatus = "applied" | "skip" | "saved";

export interface SourceResult {
  source: string;
  postings: RawPosting[];
  errors: string[];
}
