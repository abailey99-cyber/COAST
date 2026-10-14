# COAST build pack — start here

Everything Claude Code needs to build COAST — the platform, the customer
tracking portal and the marketing website — in one folder.

## What's in it

```
coast-build-pack/
├── START-HERE.md                     ← this file (for you)
├── CLAUDE.md                         ← the brief Claude Code reads automatically
├── .env.example                      ← every credential the app will ever need
├── docs/
│   ├── 00-decisions-and-conflicts.md ← where the spec and design disagree, and the answer
│   ├── 01-build-specification.md     ← the full spec (from the Word doc)
│   ├── 02-design-handoff.md          ← brand, colours, type, every screen
│   └── integrations/
│       ├── microsoft365.md
│       ├── netsuite.md
│       └── carrier-tracking.md
└── design/
    ├── tokens.css                    ← colours/type/radius as code
    ├── logo/                         ← SVG + PNG marks, app icons, favicons
    └── mockups/                      ← the 8 screen designs + how to read them
```

## How to hand it to Claude Code

1. Unzip this into a new, empty folder (e.g. `coast`). This folder becomes
   the project.
2. Open Claude Code in that folder (desktop app: open folder; terminal:
   `cd coast` then `claude`).
3. Paste this as your first message:

> Read CLAUDE.md, then docs/00-decisions-and-conflicts.md, then skim the
> spec and design handoff. Before writing any code, give me: (1) a short
> plain-English summary of what you're going to build, (2) anything in the
> pack you think is contradictory or missing, and (3) your plan for Phase 0.
> Then start Phase 0 once I say go.

4. Work phase by phase. At the end of each phase Claude Code will tell you
   what works, what's stubbed, and any decisions it needs you to confirm.

## Decisions it'll ask you to confirm (defaults already set)

- COAST is built as a multi-tenant product (no billing yet).
- Sales reps don't see supplier names.
- Working-day maths excludes weekends only (bank holidays later).
- Multi-line supplier confirmations go to the review queue.

## Things only you can do

- Trademark/domain check on "COAST" before launch.
- Terms, Privacy Policy, DPA wording (a solicitor, not Claude).
- Real prices for the Pricing page.
- Getting API credentials from Microsoft 365, NetSuite and each carrier —
  the integration guides walk through each one. Put them in environment
  variables; never paste them into chat.
