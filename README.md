# Raly: L&D leadership job aggregator

Every morning this app pulls Learning & Development manager and director postings from official job APIs and public ATS boards. It drops duplicates and roles that fail the hard rules, scores each remaining role 0–100 for fit, and emails the top 15 new ones. You can review and mark the roles on a small web dashboard.

It does not scrape LinkedIn, Indeed or Glassdoor. Every source is an API that allows programmatic access.

## How it runs

```
Vercel Cron (11:00 UTC daily) → /api/cron/daily → fetch → normalize → dedupe → filter → score → report/email
                                                                                               ↓
                                                    Postgres: postings · runs · status  ← dashboard (/)
```

| Stage | Code |
|---|---|
| Fetch: one adapter per source, run concurrently, back off on 429 | `lib/sources/` |
| Normalize: one schema, salary parsed from text when the API omits it | `lib/normalize.ts` |
| Deduplicate: same company + location, titles ≥ 90 similar; ATS link wins | `lib/dedupe.ts` |
| Filter: excluded titles, seniority, blocklist, age, location | `lib/filter.ts` |
| Score: semantic 35 / title 20 / salary 20 / skills 15 / freshness 10 | `lib/score.ts`, `lib/semantic.ts` |
| Report: HTML email and Markdown, top N, weekly digest on Mondays | `lib/report.ts`, `lib/pipeline.ts` |

A role is sent once. It comes back only if its title or salary changes. Claude (Haiku 5.5) rates semantic fit, but only for roles that pass the filters, and the verdict is cached until the posting or the profile changes. Day to day, only new postings cost API calls.

## Configure

- `config.yaml`: target titles, seniority, exclusions, salary band, metros, skills, weights, and which sources are on.
- `target_companies.yaml`: companies read straight from Greenhouse, Lever or Ashby. A wrong token shows up as a 404 in the report footer.
- `profile/reference_job.md` and `profile/resume.md`: paste these in; the semantic scorer compares every role against them.

Commit and push. Vercel redeploys, and the next run uses the new values.

Set `profile.locations.metros` to the candidate's city if hybrid or on-site roles there should count. With it empty, only remote US roles pass.

## Environment

Copy `.env.example` to `.env.local` for local use. On Vercel, set the same variables in Project Settings → Environment Variables:

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | Everything except a `--dry-run`. Any Postgres works (Neon via the Vercel Marketplace, or Supabase); the schema is created on first run |
| `ANTHROPIC_API_KEY` | Semantic fit. Without it, roles rank on the rule-based parts only |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Adzuna, the main broad source (free key) |
| `SMTP_*`, `EMAIL_FROM`, `EMAIL_TO` | Sending the daily email |
| `CRON_SECRET` | Lets Vercel Cron call `/api/cron/daily` |
| `DASHBOARD_PASSWORD` | Password for the dashboard sign-in page (stays signed in 90 days) |
| `CONTACT_EMAIL` | User-Agent contact; also required by USAJobs |
| `SERPAPI_KEY`, `RAPIDAPI_KEY`, `USAJOBS_API_KEY` | Optional sources; also switch them on in `config.yaml` |

## Local CLI

```bash
npm run jobs -- run --dry-run          # fetch + score, print Markdown, write nothing
npm run jobs -- run                    # full run: store, email, mark reported
npm run jobs -- mark <id> applied      # applied | skip | saved | clear
npm run jobs -- list saved             # new | saved | applied | skip | all
npm test
```

Skipping a role takes 10 points off similar titles at the same company in later runs.

## Schedule

`vercel.json` runs the cron at 11:00 UTC, which is 7am Eastern during daylight time and 6am in winter. Vercel crons are UTC only, so edit the schedule to match the candidate's time zone. Set `candidate.timezone` in `config.yaml` as well; the Monday digest and the dates in the report use it.
