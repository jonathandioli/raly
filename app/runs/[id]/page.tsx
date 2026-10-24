import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/db";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const run = Number.isInteger(Number(id)) ? await getRun(Number(id)) : null;
  if (!run) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="text-sm text-link">
        ← Dashboard
      </Link>
      {run.error ? (
        <pre className="mt-6 overflow-x-auto rounded-md border border-line bg-card p-4 text-xs whitespace-pre-wrap text-flag">{run.error}</pre>
      ) : run.report_html ? (
        // The report is the same HTML that was emailed; sandboxed so it can't touch this page.
        <iframe title={`Run ${run.id} report`} srcDoc={run.report_html.replace("<html>", '<html><head><base target="_blank"></head>')}sandbox="allow-popups allow-popups-to-escape-sandbox" className="mt-6 h-[80vh] w-full rounded-md border border-line bg-white" />
      ) : (
        <p className="mt-6 text-muted">This run hasn&apos;t finished.</p>
      )}
    </main>
  );
}
