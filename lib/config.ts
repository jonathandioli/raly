import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const SourceToggle = z.object({ enabled: z.boolean().default(false) }).passthrough();

const ConfigSchema = z.object({
  candidate: z.object({ timezone: z.string().default("America/New_York") }).default({ timezone: "America/New_York" }),
  profile: z.object({
    title_keywords: z.array(z.string()),
    adjacent_title_keywords: z.array(z.string()).default([]),
    domain_terms: z.array(z.string()).default([]),
    seniority: z.array(z.string()),
    excluded_titles: z.array(z.string()).default([]),
    salary: z.object({
      target: z.number(),
      sweet_min: z.number(),
      sweet_max: z.number(),
      min: z.number(),
      max: z.number(),
      floor: z.number(),
    }),
    locations: z.object({
      remote_us: z.boolean().default(true),
      metros: z.array(z.string()).nullable().default([]).transform((m) => m ?? []),
    }),
    posted_within_days: z.number().default(7),
    skills: z.array(z.string()).default([]),
    company_blocklist: z.array(z.string()).nullable().default([]).transform((b) => b ?? []),
  }),
  search_locations: z.array(z.string()).default(["Remote"]),
  weights: z.object({
    semantic: z.number(),
    title: z.number(),
    salary: z.number(),
    skills: z.number(),
    freshness: z.number(),
  }),
  penalties: z.object({ skipped_near_duplicate: z.number().default(10) }).default({ skipped_near_duplicate: 10 }),
  report: z.object({
    top_n: z.number().default(15),
    weekly_digest_day: z.string().default("Monday"),
    weekly_digest_min_score: z.number().default(60),
  }),
  scoring: z.object({
    model: z.string().default("claude-haiku-5-5"),
    concurrency: z.number().default(5),
    max_llm_calls_per_run: z.number().default(150),
  }),
  sources: z.object({
    adzuna: SourceToggle.extend({ country: z.string().default("us"), results_per_page: z.number().default(50) }),
    greenhouse: SourceToggle,
    lever: SourceToggle,
    ashby: SourceToggle,
    serpapi: SourceToggle.extend({ max_queries_per_run: z.number().default(3) }),
    jsearch: SourceToggle.extend({ max_queries_per_run: z.number().default(5) }),
    usajobs: SourceToggle,
  }),
  email: z.object({ subject_prefix: z.string().default("Raly") }),
});

const CompaniesSchema = z.object({
  companies: z.array(
    z.object({ name: z.string(), ats: z.enum(["greenhouse", "lever", "ashby"]), token: z.string() }),
  ),
});

export type Config = z.infer<typeof ConfigSchema>;
export type TargetCompany = z.infer<typeof CompaniesSchema>["companies"][number];

export interface Profile {
  config: Config;
  companies: TargetCompany[];
  resume: string;
  referenceJob: string;
}

const root = () => process.cwd();

function readText(rel: string): string {
  try {
    // These files ship via outputFileTracingIncludes in next.config.ts; don't trace the whole project.
    return fs.readFileSync(path.join(/*turbopackIgnore: true*/ root(), rel), "utf8");
  } catch {
    return "";
  }
}

// HTML comments are the placeholder instructions in profile/*.md; an untouched file reads as empty.
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();

export function parseConfig(yamlText: string): Config {
  return ConfigSchema.parse(parse(yamlText));
}

export function loadProfile(): Profile {
  return {
    config: parseConfig(readText("config.yaml")),
    companies: CompaniesSchema.parse(parse(readText("target_companies.yaml")) ?? { companies: [] }).companies,
    resume: stripComments(readText("profile/resume.md")),
    referenceJob: stripComments(readText("profile/reference_job.md")),
  };
}
