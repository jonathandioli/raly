import { runPipeline } from "@/lib/pipeline";

// Fetching ~40 ATS boards plus up to 150 Haiku calls fits well inside this.
export const maxDuration = 300;

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runPipeline({ kind: "cron", log: console.log });
  return Response.json({ runId: result.runId, stats: result.stats });
}
