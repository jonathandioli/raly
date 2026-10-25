import Link from "next/link";
import { loadProfile } from "@/lib/config";
import { ensureSchema } from "@/lib/db";
import { matchesTargetTitle } from "@/lib/filter";
import { excludedHits, prefilter } from "@/lib/prefilter";
import { EDITABLE_LISTS, applyOverrides, getListOverrides } from "@/lib/settings";
import { normTitle } from "@/lib/text";
import { saveList } from "./actions";

const GROUPS = [
  { name: "Searching", blurb: "What Raly asks the job sources for." },
  { name: "Including", blurb: "What makes a title count as an L&D or early-talent role." },
  { name: "Excluding", blurb: "What rules a role out." },
  { name: "Ranking", blurb: "What moves a role up the list." },
  { name: "Location", blurb: "Where hybrid and on-site roles can be." },
] as const;

export default async function KeywordsPage({ searchParams }: PageProps<"/keywords">) {
  const sp = await searchParams;
  const testTitle = typeof sp.title === "string" ? sp.title : "";
  const testDesc = typeof sp.desc === "string" ? sp.desc : "";

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    return <main className="mx-auto max-w-3xl px-4 py-12 text-muted">Connect a database to edit keywords.</main>;
  }
  await ensureSchema();
  const defaults = loadProfile().config;
  const overrides = await getListOverrides();
  const effective = loadProfile().config;
  applyOverrides(effective, overrides);

  const test = testTitle ? prefilter({ title: testTitle, descriptionText: testDesc }, effective.keywords) : null;
  const excluded = testTitle ? excludedHits(normTitle(testTitle), effective.keywords) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/" className="text-sm text-link">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight">Keywords</h1>
      <p className="mt-2 text-sm text-muted">
        One entry per line, case-insensitive, whole words (&ldquo;L&amp;D&rdquo;, &ldquo;Sr.&rdquo; and &ldquo;&amp;&rdquo; are normalized). Changes
        apply from the next run. Lists marked <span className="text-mid">edited</span> differ from the defaults in config.yaml.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-card p-4">
        <h2 className="text-sm font-semibold">Test a title</h2>
        <form className="mt-3 space-y-2">
          <input name="title" defaultValue={testTitle} placeholder="e.g. Senior Manager, Early Careers Programs" className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm" />
          <textarea name="desc" defaultValue={testDesc} placeholder="Optional: paste part of the description" rows={2} className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm" />
          <button className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper">Check</button>
        </form>
        {test && (
          <p className={`mt-3 text-sm ${test.pass ? "text-good" : "text-flag"}`}>
            {test.pass ? "✓ Passes" : "✗ Rejected"}: {test.reason}
            {excluded.length > 0 && ` (excluded word${excluded.length > 1 ? "s" : ""}: ${excluded.join(", ")})`}
            {test.pass && (matchesTargetTitle(testTitle, effective.profile) ? " · full title points" : " · half title points")}
            {test.bodyHits.length > 0 && <span className="text-muted"> · description phrases: {test.bodyHits.join(", ")}</span>}
          </p>
        )}
      </section>

      {GROUPS.map((g) => (
        <section key={g.name} className="mt-10">
          <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">{g.name}</h2>
          <p className="text-sm text-muted">{g.blurb}</p>
          {EDITABLE_LISTS.filter((l) => l.group === g.name).map((l) => {
            const edited = !!overrides[l.key];
            const value = l.get(effective);
            return (
              <form key={l.key} id={l.key} action={saveList} className="mt-5 scroll-mt-6">
                <input type="hidden" name="key" value={l.key} />
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={`v-${l.key}`} className="font-medium">
                    {l.label} <span className="text-sm font-normal text-muted">({value.length})</span>
                    {edited && <span className="ml-2 text-xs text-mid">edited</span>}
                    {sp.saved === l.key && <span className="ml-2 text-xs text-good">saved</span>}
                  </label>
                </div>
                <p className="mt-0.5 text-sm text-muted">{l.help}</p>
                <textarea
                  id={`v-${l.key}`}
                  name="value"
                  defaultValue={value.join("\n")}
                  rows={Math.min(14, Math.max(4, value.length + 1))}
                  className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm leading-relaxed"
                />
                <div className="mt-2 flex gap-2 text-sm">
                  <button type="submit" className="rounded-md bg-ink px-3 py-1.5 font-medium text-paper">
                    Save
                  </button>
                  {edited && (
                    <button type="submit" name="reset" value="1" className="rounded-md px-3 py-1.5 text-muted ring-1 ring-line hover:text-ink">
                      Reset to default ({l.get(defaults).length})
                    </button>
                  )}
                </div>
              </form>
            );
          })}
        </section>
      ))}
    </main>
  );
}
