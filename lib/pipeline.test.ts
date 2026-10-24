import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import { dedupe } from "./dedupe";
import { applyFilters, inMetro, isNonUs, matchTitle, rejectReason } from "./filter";
import { normalize, parseSalary } from "./normalize";
import { prefilter } from "./prefilter";
import { renderHtml, renderMarkdown } from "./report";
import { salaryPoints, scorePosting } from "./score";
import { relativeDate } from "./sources/search";
import { htmlToText, normTitle, ratio } from "./text";
import type { RawPosting } from "./types";

const config = parseConfig(fs.readFileSync("config.yaml", "utf8"));
const NOW = new Date("2026-10-24T12:00:00Z");

const raw = (over: Partial<RawPosting> = {}): RawPosting => ({
  source: "greenhouse",
  sourceKind: "ats",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  title: "Senior Manager, Learning & Development",
  company: "Acme Inc.",
  location: "Remote - US",
  postedAt: "2026-10-22T00:00:00Z",
  description: "<p>Own our LMS, onboarding and leadership development. Salary $145,000 - $170,000.</p>",
  ...over,
});

describe("text", () => {
  it("normalizes L&D, Sr. and ampersands", () => {
    expect(normTitle("Sr. Mgr, L&D")).toBe("senior manager learning development");
    expect(normTitle("Learning & Development Manager")).toBe("learning and development manager");
  });
  it("decodes Greenhouse's escaped HTML", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;")).toBe("Hello & welcome");
  });
  it("ratio matches rapidfuzz fuzz.ratio", () => {
    expect(ratio("this is a test", "this is a test!")).toBeCloseTo(96.55, 1);
    expect(ratio("abc", "abc")).toBe(100);
  });
});

describe("normalize", () => {
  it("parses salary ranges in several shapes", () => {
    expect(parseSalary("pay: $130k–$175k")).toEqual({ min: 130000, max: 175000 });
    expect(parseSalary("$140,000 to $160,000 per year")).toEqual({ min: 140000, max: 160000 });
    expect(parseSalary("$60 - $80 per hour")).toEqual({ min: 124800, max: 166400 });
    expect(parseSalary("We have 401k matching")).toBeNull();
  });
  it("maps a raw posting to the schema", () => {
    const p = normalize(raw(), NOW);
    expect(p.remoteType).toBe("remote");
    expect(p.salaryMin).toBe(145000);
    expect(p.descriptionText).not.toContain("<p>");
    expect(p.id).toHaveLength(12);
  });
  it("uses an explicit hourly salary period", () => {
    const p = normalize(raw({ salaryMin: 70, salaryMax: 80, salaryPeriod: "hour", description: "" }), NOW);
    expect(p.salaryMin).toBe(145600);
  });
});

describe("dedupe", () => {
  it("merges the same job from an aggregator and the ATS, keeping the ATS link", () => {
    const ats = normalize(raw(), NOW);
    const agg = normalize(
      raw({ source: "adzuna", sourceKind: "aggregator", url: "https://adzuna.com/x", title: "Sr Manager, Learning and Development", company: "ACME" }),
      NOW,
    );
    const out = dedupe([agg, ats]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("greenhouse");
    expect(out[0].sources.sort()).toEqual(["adzuna", "greenhouse"]);
  });
  it("keeps different roles at the same company apart", () => {
    const a = normalize(raw(), NOW);
    const b = normalize(raw({ title: "Director, Talent Development" }), NOW);
    expect(dedupe([a, b])).toHaveLength(2);
  });
  it("reuses the id of a stored near-duplicate", () => {
    const p = normalize(raw(), NOW);
    const out = dedupe([p], [{ id: "stored123456", company: "Acme", title: "Senior Manager Learning and Development", location: "Remote", remoteType: "remote" }]);
    expect(out[0].id).toBe("stored123456");
  });
});

describe("filter", () => {
  it("classifies titles", () => {
    expect(matchTitle("Director of Learning & Development", config.profile)).toBe("exact");
    expect(matchTitle("Head of L&D", config.profile)).toBe("exact");
    expect(matchTitle("Training Manager", config.profile)).toBe("adjacent");
    expect(matchTitle("Manager, Leadership Programs & Learning", config.profile)).toBe("domain");
    expect(matchTitle("Senior Software Engineer", config.profile)).toBeNull();
  });
  it("hard-rejects excluded titles, old postings and non-US remote", () => {
    const at = (over: Partial<RawPosting>) => rejectReason(normalize(raw(over), NOW), config, NOW);
    expect(at({})).toBeNull();
    expect(at({ title: "VP, Learning & Development" })).toBe("excluded_title");
    expect(at({ title: "Learning & Development Specialist" })).toBe("excluded_title");
    expect(at({ title: "Machine Learning Manager" })).toBe("excluded_title");
    expect(at({ title: "Learning Coordinator" })).toBe("excluded_title");
    expect(at({ title: "Learning Experience Designer" })).toBe("title");
    expect(at({ postedAt: "2026-10-01T00:00:00Z" })).toBe("age");
    expect(at({ location: "Remote - Canada" })).toBe("location");
    expect(at({ location: "Chicago, IL" })).toBe("location");
    expect(at({ location: "Waltham, MA (Hybrid)" })).toBeNull();
  });
  it("rejects sales/customer enablement but keeps talent roles", () => {
    const at = (title: string) => rejectReason(normalize(raw({ title }), NOW), config, NOW);
    expect(at("Sales Enablement Manager")).toBe("excluded_title");
    expect(at("Senior Customer Enablement Manager")).toBe("excluded_title");
    expect(at("Enablement Manager")).toBe("title");
    expect(at("Senior Software Engineer")).toBe("title");
    expect(at("Director, Talent Development")).toBeNull();
  });
  it("does not treat 'internal' as 'intern'", () => {
    expect(rejectReason(normalize(raw({ title: "Manager, Internal Learning & Development" }), NOW), config, NOW)).toBeNull();
  });
  it("lets hybrid roles through in a configured metro", () => {
    const withMetro = { ...config, profile: { ...config.profile, locations: { remote_us: true, metros: ["Chicago, IL"] } } };
    const p = normalize(raw({ location: "Chicago, IL (Hybrid)" }), NOW);
    expect(applyFilters([p], withMetro, NOW).kept).toHaveLength(1);
  });
  it("matches metros by city and state", () => {
    const m = ["Manchester, NH", "Boston, MA"];
    expect(inMetro("Manchester, New Hampshire", m)).toBe(true);
    expect(inMetro("USA, NH, Manchester", m)).toBe(true);
    expect(inMetro("MA - Boston", m)).toBe(true);
    expect(inMetro("Manchester, England", m)).toBe(false);
    expect(inMetro("Manchester, CT", m)).toBe(false);
    expect(inMetro("Concord, CA; Boston, MA", m)).toBe(true);
    expect(inMetro("Bedford, TX; Springfield, MA", ["Bedford, MA"])).toBe(false);
  });
  it("spots non-US locations", () => {
    expect(isNonUs("London, UK")).toBe(true);
    expect(isNonUs("Remote, US")).toBe(false);
  });
});

describe("score", () => {
  it("scores salary bands per the spec", () => {
    const s = (min: number | null, max: number | null) => salaryPoints({ salaryMin: min, salaryMax: max, salaryCurrency: "USD" }, config);
    expect(s(145000, 160000)).toBe(20);
    expect(s(170000, 190000)).toBe(12);
    expect(s(null, null)).toBe(10);
    expect(s(90000, 110000)).toBe(0);
  });
  it("ranks a strong fit above a weak one and applies the skip penalty", () => {
    const strong = normalize(raw(), NOW);
    const weak = normalize(raw({ title: "Training Manager", description: "Run safety trainings. $90,000 - $105,000", postedAt: "2026-10-18T00:00:00Z", sourceKind: "aggregator" }), NOW);
    const a = scorePosting(strong, { score: 9, reason: "Strong", red_flags: [] }, config, [], NOW);
    const b = scorePosting(weak, { score: 3, reason: "Weak", red_flags: ["not really L&D"] }, config, [], NOW);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.score).toBeLessThanOrEqual(100);
    const penalized = scorePosting(strong, { score: 9, reason: "", red_flags: [] }, config, [{ company: "Acme", title: "Senior Manager, Learning and Development" }], NOW);
    expect(penalized.score).toBe(a.score - 10);
  });
});

describe("prefilter", () => {
  const pf = (title: string, descriptionText = "") => prefilter({ title, descriptionText });
  it("passes L&D and talent roles at manager+ level", () => {
    expect(pf("Senior Leadership Development Manager").pass).toBe(true);
    expect(pf("Head of Talent Experience & Enablement").pass).toBe(true);
    expect(pf("People Programs Lead", "Design our onboarding program and career development paths.").pass).toBe(true);
  });
  it("drops sales/GTM enablement, engineers, and non-manager roles", () => {
    expect(pf("Principal, Sales Enablement", "LMS and curriculum").pass).toBe(false);
    expect(pf("GTM Motions & Skills Enablement Lead", "facilitation").pass).toBe(false);
    expect(pf("Enablement Business Partner", "competency").pass).toBe(false);
    expect(pf("Machine Learning Engineer, Post Training").pass).toBe(false);
    expect(pf("Senior Instructional Designer", "LMS").pass).toBe(false);
    expect(pf("Store Manager in Training", "coaching and onboarding program").pass).toBe(false);
  });
  it("catches an odd title when the description is clearly L&D", () => {
    const body = "Own the LMS, instructional design, needs analysis, Kirkpatrick evaluation and leadership development.";
    expect(pf("Manager, People Experience", body).pass).toBe(true);
  });
});

describe("report", () => {
  it("renders both formats with stats and escapes HTML", () => {
    const input = {
      date: NOW,
      timezone: "America/New_York",
      items: [{ id: "abc", score: 82, title: "Head of L&D <script>", company: "Acme", location: "Remote", remoteType: "remote", salaryMin: 150000, salaryMax: 170000, postedAt: NOW, reason: "Great fit.", redFlags: ["heavy travel"], url: "https://x.test/1" }],
      digest: [],
      stats: { fetched: { greenhouse: 10 }, sourceErrors: { lever: ["Foo: HTTP 404"] }, normalized: 10, afterDedupe: 9, afterFilters: 1, rejected: {}, llmCalls: 1, llmCached: 0, llmErrors: 0, reported: 1, digest: 0, emailed: false, durationMs: 1000 },
    };
    expect(renderMarkdown(input)).toContain("$150k–$170k");
    const html = renderHtml(input);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("lever errors (1)");
  });
  it("turns Google Jobs relative ages into dates", () => {
    expect(relativeDate("3 days ago", NOW)?.toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });
});
