import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Profile } from "./config";
import type { Posting, SemanticResult } from "./types";

const Verdict = z.object({
  score: z.number().describe("0-10 fit for the candidate"),
  reason: z.string().describe("One sentence on why"),
  red_flags: z.array(z.string()),
});

function systemPrompt(profile: Profile): string {
  const { resume, referenceJob } = profile;
  const p = profile.config.profile;
  return [
    "You screen job postings for one candidate looking for a mid-level Learning & Development leadership role",
    `(${profile.config.keywords.seniority.join(", ")}; base salary around $${Math.round(p.salary.target / 1000)}k).`,
    "Rate how well each posting fits on a 0-10 scale, where 10 is as good a fit as the reference job and 0 is irrelevant.",
    "Judge the actual work described, not the title: scope, who the role leads, and whether it owns L&D strategy and budget.",
    "",
    "Give a one-sentence reason a busy reader can act on, and list red flags that apply, using these wordings when they fit:",
    '"actually an individual-contributor role", "heavy travel", "contract only", "below target seniority",',
    '"above target seniority", "not really L&D", "salary below target". Use an empty list when none apply.',
    "",
    referenceJob ? `<reference_job>\n${referenceJob}\n</reference_job>` : "No reference job was provided; rely on the résumé and the role description above.",
    resume ? `<candidate_resume>\n${resume}\n</candidate_resume>` : "No résumé was provided.",
  ].join("\n");
}

/** Cache key: an unchanged posting judged against an unchanged profile is never re-scored. */
export function semanticHash(p: Posting, profile: Profile): string {
  return createHash("sha1")
    .update([profile.config.scoring.model, profile.resume, profile.referenceJob, p.title, p.company, p.location, p.descriptionText].join("\u0000"))
    .digest("hex");
}

export const semanticEnabled = () => !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;

export async function rateFit(p: Posting, profile: Profile): Promise<SemanticResult> {
  client ??= new Anthropic();
  const salary = p.salaryMin ? `$${p.salaryMin.toLocaleString()}–$${(p.salaryMax ?? p.salaryMin).toLocaleString()}` : "not listed";
  const response = await client.messages.parse({
    model: profile.config.scoring.model,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(Verdict) },
    // The system prompt (reference job + résumé) is identical for every posting in a run, so cache it.
    system: [{ type: "text", text: systemPrompt(profile), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `<posting>\nTitle: ${p.title}\nCompany: ${p.company}\nLocation: ${p.location} (${p.remoteType})\nSalary: ${salary}\n\n${p.descriptionText}\n</posting>`,
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`no verdict (stop_reason ${response.stop_reason})`);
  }
  const v = response.parsed_output;
  return { score: Math.max(0, Math.min(10, v.score)), reason: v.reason.trim(), red_flags: v.red_flags };
}
