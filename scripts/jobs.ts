// Local CLI:
//   npm run jobs -- run [--dry-run] [--no-email] [--digest]
//   npm run jobs -- mark <id> applied|skip|saved|clear
//   npm run jobs -- list [new|saved|applied|skip|all]
import { db, listPostings, setStatus } from "../lib/db";
import { runPipeline } from "../lib/pipeline";
import { formatSalary } from "../lib/report";
import type { MarkStatus } from "../lib/types";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);

async function main() {
  switch (cmd) {
    case "run": {
      const result = await runPipeline({
        dryRun: flag("dry-run"),
        email: !flag("no-email"),
        digest: flag("digest") ? true : undefined,
        kind: "cli",
        log: (m) => console.error(m),
      });
      console.log(result.markdown);
      break;
    }
    case "mark": {
      const [id, status] = args;
      const valid = ["applied", "skip", "saved", "clear"];
      if (!id || !valid.includes(status)) throw new Error(`usage: jobs mark <id> ${valid.join("|")}`);
      await setStatus(id, status === "clear" ? null : (status as MarkStatus));
      console.log(`${id} → ${status}`);
      break;
    }
    case "list": {
      const view = (args[0] ?? "new") as "new" | MarkStatus | "all";
      const rows = await listPostings({ view, days: 14, limit: 50 });
      for (const r of rows) {
        console.log(`${String(r.score).padStart(3)}  ${r.id}  ${r.title} — ${r.company} · ${formatSalary(r.salary_min, r.salary_max)}${r.status ? ` [${r.status}]` : ""}`);
      }
      break;
    }
    default:
      console.log("usage: jobs run [--dry-run] [--no-email] [--digest] | jobs mark <id> applied|skip|saved|clear | jobs list [view]");
      process.exitCode = cmd ? 1 : 0;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.DATABASE_URL ?? process.env.POSTGRES_URL) return db().end();
  });
