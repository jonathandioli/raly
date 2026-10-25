import type { Config } from "./config";
import { db } from "./db";

// Keyword lists editable from the dashboard. config.yaml holds the defaults; an edit is stored
// as an override in the settings table and replaces that one list on every later run.

export interface EditableList {
  key: string;
  label: string;
  group: "Searching" | "Including" | "Excluding" | "Ranking" | "Location";
  help: string;
  get: (c: Config) => string[];
  set: (c: Config, v: string[]) => void;
}

export const EDITABLE_LISTS: EditableList[] = [
  {
    key: "search_terms",
    label: "Search terms",
    group: "Searching",
    help: "Sent as searches to company job boards (Workday, Oracle, Eightfold, KPMG). More terms find more, but each one adds requests to every run.",
    get: (c) => c.keywords.search_terms,
    set: (c, v) => void (c.keywords.search_terms = v),
  },
  {
    key: "title_keywords",
    label: "Target titles",
    group: "Searching",
    help: "Queries for the job-board aggregators (Adzuna, JSearch, Google Jobs). A title containing every word of one gets full title points in the score.",
    get: (c) => c.profile.title_keywords,
    set: (c, v) => void (c.profile.title_keywords = v),
  },
  {
    key: "strong_titles",
    label: "L&D title words",
    group: "Including",
    help: "A title with one of these plus a seniority word passes on its own.",
    get: (c) => c.keywords.strong_titles,
    set: (c, v) => void (c.keywords.strong_titles = v),
  },
  {
    key: "soft_titles",
    label: "Softer title words",
    group: "Including",
    help: "These pass only when the description also contains an L&D phrase (below).",
    get: (c) => c.keywords.soft_titles,
    set: (c, v) => void (c.keywords.soft_titles = v),
  },
  {
    key: "early_talent_titles",
    label: "Early-talent phrases",
    group: "Including",
    help: "University relations, internship and co-op programs, new-hire experience. Matched as whole phrases; passes with a seniority word.",
    get: (c) => c.keywords.early_talent_titles,
    set: (c, v) => void (c.keywords.early_talent_titles = v),
  },
  {
    key: "seniority",
    label: "Seniority words",
    group: "Including",
    help: "Every passing title needs one of these.",
    get: (c) => c.keywords.seniority,
    set: (c, v) => void (c.keywords.seniority = v),
  },
  {
    key: "description_terms",
    label: "L&D description phrases",
    group: "Including",
    help: "Evidence of real L&D work in a description. A softer title needs 1; a title with no L&D words needs 5. Matches word starts, so \"facilitat\" covers facilitate and facilitation.",
    get: (c) => c.keywords.description_terms,
    set: (c, v) => void (c.keywords.description_terms = v),
  },
  {
    key: "exclude_titles",
    label: "Excluded title words",
    group: "Excluding",
    help: "Any of these in a title rejects it. In a title that names an early-talent program, words from those phrases (intern, recruiting…) are ignored.",
    get: (c) => c.keywords.exclude_titles,
    set: (c, v) => void (c.keywords.exclude_titles = v),
  },
  {
    key: "company_blocklist",
    label: "Blocked companies",
    group: "Excluding",
    help: "Roles at these companies are never shown.",
    get: (c) => c.profile.company_blocklist,
    set: (c, v) => void (c.profile.company_blocklist = v),
  },
  {
    key: "skills",
    label: "Skills",
    group: "Ranking",
    help: "Share of these found in a description sets the skills part of the score.",
    get: (c) => c.profile.skills,
    set: (c, v) => void (c.profile.skills = v),
  },
  {
    key: "metros",
    label: "Metro areas",
    group: "Location",
    help: "Hybrid and on-site roles pass only here. Use \"City, ST\" so Manchester, NH doesn't match Manchester, England. Remote US roles always pass.",
    get: (c) => c.profile.locations.metros,
    set: (c, v) => void (c.profile.locations.metros = v),
  },
];

/** One entry per line; trims, drops blanks and duplicates (case-insensitive). */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

export async function getListOverrides(): Promise<Record<string, string[]>> {
  const rows = await db()`select key, value from settings where key like 'list:%'`;
  return Object.fromEntries(rows.map((r) => [String(r.key).slice(5), r.value as string[]]));
}

export async function setListOverride(key: string, value: string[] | null) {
  const sql = db();
  if (!value) await sql`delete from settings where key = ${`list:${key}`}`;
  else
    await sql`insert into settings (key, value) values (${`list:${key}`}, ${sql.json(value)})
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

/** Apply dashboard edits on top of config.yaml, in place. */
export function applyOverrides(config: Config, overrides: Record<string, string[]>) {
  for (const list of EDITABLE_LISTS) if (overrides[list.key]) list.set(config, overrides[list.key]);
}
