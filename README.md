# COAST

Centralised Order And Shipment Tracking — the staff app, customer tracking
portal and marketing site in one Next.js + Supabase codebase.

- **The brief:** [CLAUDE.md](CLAUDE.md), then [docs/](docs/) and [design/](design/).
- **What isn't finished:** [KNOWN-GAPS.md](KNOWN-GAPS.md).

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs COAST on your computer at http://localhost:3000 |
| `npm run check` | Typecheck, lint, unit tests and a production build — what CI runs |
| `npm run test:e2e` | Browser tests (run `npm run build` first) |
| `npm run db:push` | Applies any new database migrations to the linked Supabase project |
| `npm run db:seed-demo` | Creates the demo organisations and one sign-in per role (not in production) |
| `npm run org:create -- --name "…" --slug … --admin-email … --admin-name "…"` | Sets up a real organisation and prints a set-password link for its first admin |

## How the code is laid out

```
src/lib/logic/   pure rules — no database, no clock, fully unit-tested
src/lib/data/    database reads and writes only
src/server/      sign-in and role checks, then calls the two above
src/app/         pages (marketing), (auth), (app) = staff, (portal) = customers
src/components/  shared UI
supabase/        config and numbered migrations (never edit the database by hand)
scripts/         admin scripts run from your computer
tests/           browser tests (e2e) and database security tests (rls)
```

Lint rules stop the layers reaching past each other. For example, pure logic
can't touch the database or read the clock, and pages can't query the
database directly.

## Demo sign-ins (development only)

After `npm run db:seed-demo`, sign in with any of these and the
`DEMO_USER_PASSWORD` from your `.env.local`:

`admin@`, `procurement@`, `salesmanager@`, `sales@`, `sales2@`, `director@`, `goodsin@` + `demo-a.coast.test`,
and `admin@demo-b.coast.test` (a second organisation, for isolation tests).
