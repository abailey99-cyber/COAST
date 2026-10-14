# Mockups — how to read these files

These are **layout references, not code to copy**. Each `*.dc.html` file is a
"Design Component" export: inline-styled HTML with `{{placeholder}}` values
filled in by a small runtime (`support.js`) that is **not included** in this
pack. Opened directly in a browser they will look broken — that's expected.

How to use them when building:

- Read the HTML for **structure, copy, spacing, order of sections and
  component anatomy**. The copy in them is approved wording — reuse it.
- Resolve every `{{t.xxx}}` / `{{accent}}` placeholder via the theme objects in
  the `<script type="text/x-dc">` block at the bottom of each file. Those
  values are already captured as CSS variables in `../tokens.css` — use the
  variables, not the hex codes.
- `{{accent}}` is always Tide Teal `#1F8A9C`. The colour picker options in the
  script (`#E07A3F` etc.) were design-tool experiments — ignore them.
- Build each screen as real components in the app (React/Next.js), styled
  from `tokens.css`. Do not ship `.dc.html` files or inline styles.
- Sample data (`SO-10421`, `[Customer A]`, `148 open orders`) is illustrative.
  In the product, it comes from the database; in seed data, keep the
  `[Placeholder]` style rather than inventing real-looking company names.

| File | Screen | Handoff section |
|---|---|---|
| `Logo.dc.html` | Final logo sheet — lockups, app icon, favicon | §3 |
| `App.dc.html` | Internal Orders dashboard (dark default + light toggle) | §7.1 |
| `Customer.dc.html` | Customer tracking page (light, white-label header) | §7.2 |
| `Website.dc.html` | Marketing home | §7.3–7.4 |
| `HowItWorks.dc.html` | How it works | §7.5 |
| `Integrations.dc.html` | Integrations & roadmap | §7.6 |
| `Pricing.dc.html` | Pricing, security & FAQ | §7.7 |
| `SignIn.dc.html` | Shared sign-in (team / track an order) | §7.8 |
