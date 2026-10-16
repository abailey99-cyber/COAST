# Environments: development, staging, production

Readiness plan Task 5A. COAST runs as three separate copies, each with its
own database and its own settings, so testing can never touch real customer
data and a leaked development key can't reach production.

| | Development | Staging | Production |
|---|---|---|---|
| Who uses it | You and Claude Code, building | You, trying things before customers do | Real customers |
| Database (Supabase project) | `COAST` (today's project, EU — Ireland) | New project, e.g. `COAST staging` | New project, e.g. `COAST production` |
| Region | EU | EU (London `eu-west-2` or Ireland `eu-west-1`) | Same as staging |
| Hosting (Vercel) | Your computer (`npm run dev`) | Vercel **Preview** environment | Vercel **Production** environment |
| `COAST_ENV` | `development` | `staging` | `production` |
| Where its secrets live | `.env.local` on your computer | Vercel → Settings → Environment Variables → Preview | Vercel → … → Production **only** |
| Demo data (`npm run db:seed-demo`) | Yes | Yes | **Never** (the script refuses) |

**The production rule:** production keys exist only in Vercel's Production
settings. Never paste them into `.env.local`, a chat, a document or a
commit — then nothing on your computer (including Claude Code) can read
them. If one ever leaks, rotate it in Supabase straight away.

## Founder steps (one-off, about 30 minutes)

1. **Supabase:** create two new projects, `COAST staging` and
   `COAST production`, in an EU region. Use a strong database password for
   each and keep it in your password manager.
2. **Database schema:** for each new project, in a terminal in this folder:
   `npx supabase link --project-ref <the project's ref>` then
   `npm run db:push`. (Then link back to development:
   `npx supabase link --project-ref vveargoqkggjerevslzr`.)
3. **Vercel:** in the COAST project, open Settings → Environment Variables
   and add every variable from `.env.example` twice — once ticked for
   **Preview** with the staging values, once ticked for **Production** with
   the production values. Set `COAST_ENV` to `staging` and `production`.
   Use a new, different `CRON_SECRET` for each.
4. **Staging demo data:** temporarily put the staging values in a separate
   file and run `npx tsx --env-file=<that file> scripts/seed-demo.ts`, then
   delete the file. (Never do this with production values.)
5. **GitHub:** add `COAST_APP_URL` and `CRON_SECRET` repository secrets for
   production so the scheduled jobs run (see `.github/workflows/`).
6. **Protect `main` on GitHub** (Settings → Branches → Add rule for `main`):
   require a pull request before merging, require the status checks
   "Typecheck, lint, test, build, browser tests" and "Secret scan and
   dependency audit" to pass, and block force pushes.

When step 6 is on, Claude Code works on a branch and opens a pull request for
each change instead of pushing to `main`. That needs the GitHub CLI (`gh`)
installed and signed in on this computer.

## What the code already does

- Scripts that write demo data refuse to run when `COAST_ENV=production`.
- The mock carrier and other test-only options are hidden when
  `COAST_ENV=production`.
- Every integration is optional: a missing credential shows as
  "Not set up", never a crash.
