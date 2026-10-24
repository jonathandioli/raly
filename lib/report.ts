import type { RunStats } from "./db";

export interface ReportItem {
  id: string;
  score: number;
  title: string;
  company: string;
  location: string;
  remoteType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  postedAt: Date | null;
  reason: string | null;
  redFlags: string[];
  url: string;
}

export interface ReportInput {
  date: Date;
  timezone: string;
  items: ReportItem[];
  digest: ReportItem[];
  stats: RunStats;
  dashboardUrl?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function formatSalary(min: number | null, max: number | null): string {
  if (!min && !max) return "not listed";
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  return min === max || !max ? k(min!) : `${k(min!)}–${k(max)}`;
}

export const formatDate = (d: Date | null, tz: string) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz }) : "unknown";

const where = (i: ReportItem) => (i.remoteType === "remote" ? (i.location && !/remote/i.test(i.location) ? `Remote · ${i.location}` : "Remote") : `${i.location}${i.remoteType === "hybrid" ? " (hybrid)" : ""}`);

function statsLines(s: RunStats): string[] {
  const fetched = Object.entries(s.fetched).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  const lines = [
    `Fetched: ${fetched}`,
    `After dedupe: ${s.afterDedupe} · after filters: ${s.afterFilters} · LLM calls: ${s.llmCalls} (${s.llmCached} cached${s.llmErrors ? `, ${s.llmErrors} failed` : ""})`,
  ];
  const errs = Object.entries(s.sourceErrors).filter(([, e]) => e.length);
  for (const [src, e] of errs) lines.push(`${src} errors (${e.length}): ${e.slice(0, 5).join("; ")}${e.length > 5 ? "; …" : ""}`);
  return lines;
}

export function renderMarkdown(r: ReportInput): string {
  const day = r.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: r.timezone });
  const section = (items: ReportItem[]) =>
    items
      .map((i, n) =>
        [
          `### ${n + 1}. ${i.title} — ${i.company} (${i.score})`,
          `${where(i)} · ${formatSalary(i.salaryMin, i.salaryMax)} · posted ${formatDate(i.postedAt, r.timezone)} · id \`${i.id}\``,
          i.reason ? `> ${i.reason}` : "",
          i.redFlags.length ? `**Red flags:** ${i.redFlags.join(", ")}` : "",
          `[Apply](${i.url})`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      )
      .join("\n\n");
  const parts = [`# L&D roles — ${day}`, r.items.length ? section(r.items) : "_No new roles today._"];
  if (r.digest.length) parts.push(`## Weekly digest: scored 60+ and not yet marked`, section(r.digest));
  parts.push("---", ...statsLines(r.stats).map((l) => `- ${l}`));
  return parts.join("\n\n") + "\n";
}

export function renderHtml(r: ReportInput): string {
  const day = r.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: r.timezone });
  const card = (i: ReportItem, n: number) => `
    <tr><td style="padding:16px 0;border-bottom:1px solid #e7e5e4">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="44" style="font:600 20px/1 Georgia,serif;color:${i.score >= 70 ? "#166534" : i.score >= 55 ? "#854d0e" : "#57534e"}">${i.score}</td>
        <td valign="top">
          <div style="font:600 16px/1.3 -apple-system,Segoe UI,sans-serif;color:#1c1917">${n + 1}. <a href="${esc(i.url)}" style="color:#1c1917;text-decoration:none">${esc(i.title)}</a></div>
          <div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#44403c">${esc(i.company)} · ${esc(where(i))} · <b>${esc(formatSalary(i.salaryMin, i.salaryMax))}</b> · posted ${esc(formatDate(i.postedAt, r.timezone))}</div>
          ${i.reason ? `<div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#57534e;margin-top:6px">${esc(i.reason)}</div>` : ""}
          ${i.redFlags.length ? `<div style="font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#b91c1c;margin-top:4px">⚑ ${esc(i.redFlags.join(" · "))}</div>` : ""}
          <div style="margin-top:8px;font:13px -apple-system,Segoe UI,sans-serif"><a href="${esc(i.url)}" style="color:#1d4ed8">Apply →</a>
          <span style="color:#a8a29e">&nbsp; id ${esc(i.id)}</span></div>
        </td></tr></table>
    </td></tr>`;
  const section = (title: string, items: ReportItem[]) =>
    `<h2 style="font:600 13px -apple-system,Segoe UI,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#78716c;margin:28px 0 0">${esc(title)}</h2>
     <table width="100%" cellpadding="0" cellspacing="0">${items.map(card).join("")}</table>`;
  return `<!doctype html><html><body style="margin:0;background:#fafaf9">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;background:#fafaf9">
    <h1 style="font:600 24px/1.2 Georgia,serif;color:#1c1917;margin:0">L&amp;D roles</h1>
    <div style="font:14px -apple-system,Segoe UI,sans-serif;color:#78716c;margin-top:4px">${esc(day)} · ${r.items.length} new${r.dashboardUrl ? ` · <a href="${esc(r.dashboardUrl)}" style="color:#1d4ed8">open dashboard</a>` : ""}</div>
    ${r.items.length ? section(`Top ${r.items.length} new roles`, r.items) : `<p style="font:15px -apple-system,sans-serif;color:#57534e">No new roles today.</p>`}
    ${r.digest.length ? section("Weekly digest · scored 60+, not yet marked", r.digest) : ""}
    <div style="margin-top:28px;font:12px/1.6 -apple-system,Segoe UI,sans-serif;color:#a8a29e">${statsLines(r.stats).map(esc).join("<br>")}</div>
  </div></body></html>`;
}
