# COAST — Brand & Design Handoff

*Version 1.0 · October 2026*

This is the complete design reference for **COAST**: the brand, the logo, colours, typography, and every screen designed so far. It covers the web app, the customer tracking page, and the public marketing website. Everything a designer or developer needs to rebuild these screens is in this document and the files that come with it.

> **Pack note:** in this build pack the logo files are in `design/logo/`, the mockups in `design/mockups/`, and the colour/type tokens below are also captured as CSS variables in `design/tokens.css`. Where this document and the build specification disagree, see `docs/00-decisions-and-conflicts.md`.

---

## 1. The product in one paragraph

COAST is an order-visibility platform. It follows each customer order from the purchase order sent to a supplier, through supplier confirmation and dispatch, to delivery at the customer's door. It chases suppliers and carriers automatically, keeps a predicted delivery date up to date, and gives customers an honest, self-service view of their order. For orders shipped straight from a supplier, the customer never sees who that supplier is.

---

## 2. Name

| | |
|---|---|
| Brand / product | **COAST** (always capitals) |
| Stands for | **C**entralised **O**rder **A**nd **S**hipment **T**racking |
| Company (planned) | COAST Visibility Ltd, trading as COAST |
| Primary line | Know where every order is, before your customer asks. |
| Secondary line | From PO to doorstep. |

Tone of voice: plain English, direct, honest. Never overstate what's live. Unconfirmed things are described as estimates or ranges.

---

## 3. Logo — the "Lighthouse C"

A C-shaped ring opening to the right, a solid dot at its centre, and a soft beam shining out through the opening. The dot is the order, the ring is the view around it, and the beam is visibility.

**Use the supplied SVG files. Do not redraw the mark.**

### Mark geometry (viewBox 0 0 120 120)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <path d="M50 60 L118 40 L118 80 Z" fill="#1F8A9C" fill-opacity="0.3"/>
  <path d="M88.1 38 A44 44 0 1 0 88.1 82" fill="none" stroke="#0E2A3B" stroke-width="8" stroke-linecap="round"/>
  <circle cx="50" cy="60" r="12" fill="#1F8A9C"/>
</svg>
```

- **On dark backgrounds:** ring stroke becomes `#FFFFFF`, beam opacity rises to 0.5.
- **App icon:** mark at 70% scale, centred on a Deep Sea tile with 26/120 corner radius, white ring.
- **Favicon (16–48px):** simplified geometry on a navy tile with thicker strokes (see `coast-favicon.svg`).

### Lockups

| Lockup | Construction |
|---|---|
| Horizontal (primary) | Mark, then "COAST" in Sora Bold (letter-spacing 0.08em) with "VISIBILITY" beneath in Sora Regular (letter-spacing ~0.42em, Tide Teal Deep on light / `#8FD0DA` on dark) |
| Stacked | Mark centred above the same two-line wordmark |
| Nav / compact | Mark at 36–40px, "COAST" 18–20px Bold, "VISIBILITY" 10px |

**Clear space:** at least the diameter of the dot on every side.

**Don't:** recolour the ring outside the palette, rotate the mark, put the beam outside the ring opening, or stretch it.

---

## 4. Colour

### Core palette

| Name | Hex | Use |
|---|---|---|
| Deep Sea | `#0E2A3B` | Brand navy. Logo ring, headings, dark surfaces |
| Tide Teal | `#1F8A9C` | Accent. Logo dot and beam, progress bars, highlights |
| Tide Teal Deep | `#1A7584` | **Filled buttons and badges with white text** |
| Sea Mist | `#F4F6F5` | Light page background |

**Accessibility rule:** white text on Tide Teal (`#1F8A9C`) is about 4.1:1 and fails WCAG AA for body-size text. Any filled button or badge carrying white text uses **Tide Teal Deep** (`#1A7584`, about 5.4:1). Tide Teal stays for non-text accents.

### Light theme (website, customer page, light app mode)

| Token | Hex |
|---|---|
| bg | `#F4F6F5` |
| surface | `#FFFFFF` |
| selected | `#E3F1F3` |
| divider | `#E3E9EB` |
| border | `#C9D6DA` |
| text | `#0E2A3B` |
| text-secondary | `#3D5A66` |
| text-muted | `#5E7884` |
| link | `#1F6F80` |

### Dark theme (app default, website hero and feature bands)

| Token | Hex |
|---|---|
| bg | `#0A1F2C` |
| surface | `#0E2A3B` |
| surface-raised | `#12344A` |
| surface-selected | `#173B4F` |
| divider | `#1B4258` |
| border | `#24506A` |
| text | `#E6EEF0` |
| text-secondary | `#C9D6DA` |
| text-muted | `#9FB4BC` |
| accent-soft | `#8FD0DA` |

### Status colours

| Status | On dark | On light |
|---|---|---|
| On track | `#7FE0A8` | `#2C7A4E` |
| At risk / estimate | `#FFC37A` | `#9A5A12` |
| Review / discrepancy | `#FF9C8A` | `#B23A26` |
| Delivered / neutral | `#9FB4BC` | `#3D5A66` |

Status is never shown by colour alone. Always pair it with a label ("● On track").

---

## 5. Typography

- **Typeface:** Sora (Google Fonts), weights 400, 600, 700. Fallback: system sans-serif.
- **Headings:** Bold. Page H1 on marketing pages uses fluid sizing, roughly `clamp(2.2rem, 4vw, 3.8rem)`, line-height ~1.1.
- **Body:** Regular, 15–18px, line-height 1.6.
- **Labels, buttons, nav active state:** SemiBold.
- **Eyebrows** (small labels above headings): 13px, uppercase, letter-spacing 0.2em, Tide Teal Deep on light or `#8FD0DA` on dark.

---

## 6. Components and layout rules

- **Radius:** cards 14–18px, large feature panels 20–24px, buttons and inputs 10–12px, pills 999px.
- **Buttons:** primary is Tide Teal Deep fill with white SemiBold text; secondary is a 1px border (`#C9D6DA` on light, `#3D6A80` on dark) with no fill. Minimum height 44px (48–52px on marketing pages).
- **Inputs:** 44–50px tall, 1px border, visible labels (visually hidden only where the context is obvious).
- **Cards:** white on Sea Mist, no border needed; very soft shadow only on raised feature cards.
- **Source badges** on updates: small uppercase pill. `CARRIER · <NAME>` in teal on `#E3F1F3`, and `SHIPPER UPDATE` in grey on `#EDF1F2`.
- **Progress tracker:** five equal segments (Ordered, Confirmed, Dispatched, In transit, Delivered), filled in Tide Teal up to the current stage, current label in bold.
- **Content width:** marketing pages max 1200px; customer page max 960px; 24px side gutters.
- **Responsive:** every page works at phone width. Sidebars stack above content, nav wraps, wide tables scroll horizontally inside their card.
- **Icons:** simple line icons or monogram tiles. No emoji. Carrier and partner logos are shown as initials until permission to use real logos is confirmed.

---

## 7. Screens

### 7.1 Web app — Orders dashboard

Internal app for purchasing, sales, logistics and admin users. **Dark theme by default, with a Light/Dark toggle** in the header.

- **Sidebar:** compact lockup; nav: Orders (active), Purchase orders, Review queue (count badge), Chases (amber count badge), Shipments, Suppliers, Metrics, Settings. Bottom card: "Carrier connections · ● 7 healthy · ● 1 check".
- **Header:** H1 "Orders", sub-line "Every order from PO to doorstep"; theme toggle; search "Search order, customer, PO, tracking…"; primary button "New order".
- **KPI tiles:** Open orders (148) · At risk (9, amber) · Awaiting supplier (23) · Auto-confirmed this week (61%). Numbers are sample data.
- **Orders table:** filter pills (All open, At risk, Direct ship, Delivered). Columns: Order · Customer · Fulfilment · Stage · Predicted · Status. Sample rows mix Direct ship, Via warehouse and From stock, with stages such as "Supplier confirmed", "In transit to us", "Awaiting supplier", "Out for delivery", "Discrepancy · qty", "Delivered".
- **Selected-order panel:** order number and status; "Predicted delivery Thu 16 Oct"; timeline where each event shows its source and confidence ("Supplier confirmed 16 Oct · Magic link · high confidence"); a **"Customer view shows: …"** preview of the masked message; button "Copy customer tracking link".

### 7.2 Customer tracking page

What an end customer sees from a tracking link or their account. **Light theme with a Deep Sea header. White-label:** the business's own logo and name sit top-left, with a small "Tracking by COAST" credit top-right.

1. **Header:** "Order SO-10421 · placed Mon 6 October"; H1 **"Arriving Thursday 16 October"**; status pill "● Confirmed · on track"; "Last updated today, 10:42".
2. **Progress card:** five-stage tracker; plain-English latest update underneath.
3. **Updates timeline** (newest first), each with a source badge: "Dispatched · CARRIER · DHL EXPRESS"; "Delivery date confirmed: 16 October · SHIPPER UPDATE"; "Estimated 14–17 October (shown as a range until confirmed)"; "Order received".
4. **In this order:** product lines and quantities; delivery address.
5. **Help card (dark):** "Questions about this order? Your account manager is [Rep name]." Button "Send a message" (only shown once messaging exists).
6. **"View all my orders"** link (only for account-scoped links or signed-in customers).

Rule: the customer never sees supplier names, PO numbers, costs, internal notes, or the origin address of a direct shipment.

### 7.3 Public website — shared header and footer

- **Header (Deep Sea):** reversed lockup (links home); nav: How it works · Integrations · Pricing · Sign in; primary button "Register interest". The current page's nav item is white and SemiBold.
- **Footer:** "© 2026 COAST Visibility Ltd" · Privacy · Terms · Contact.

### 7.4 Website — Home

1. **Hero (dark):** eyebrow "Centralised Order And Shipment Tracking"; H1 "Know where every order is, before your customer asks."; body "COAST follows each order from purchase order to doorstep. It chases suppliers for you, tracks every carrier in one place, and gives your customers an honest delivery date, even before anything has shipped."; buttons "Register interest" / "See how it works"; a sample tracking card captioned "What your customer sees. No supplier names, no PO numbers."
2. **Problem:** H2 "Order status shouldn't live in five inboxes and someone's memory." Three cards: Chasing by hand · "Where's my order?" · Drop-ship exposure.
3. **How it works (summary):** H2 "From PO to doorstep, on its own." Four numbered steps: PO goes out automatically · Replies are read for you · Carriers tracked live · Customers see the truth.
4. **Features (dark band):** H2 "Built for the people who buy, ship and answer the phone." Six cards: Automatic chasing · At-risk before it's late · Discrepancy flags · Supplier masking · Supplier performance · Predictable, no black box.
5. **Customer view:** H2 "One link. An honest answer." Bullets: revocable, time-limited links; optional customer accounts; your brand, not your supplier's. Sample "Your orders" list showing On track, Estimate (range) and Complete states.
6. **Register interest band (dark):** H2 "Be one of the first teams on COAST." "Priced by order volume, so you only pay for what you track." Email field + button.

### 7.5 Website — How it works

1. **Hero:** eyebrow "How it works"; H1 "One order, followed from purchase order to doorstep."; jump links to the four phases.
2. **"It starts with how each line is fulfilled":** three cards with their stage sequences:
   - From stock: Picked → Dispatched → In transit → Delivered
   - Via your warehouse: PO → Confirmed → Inbound → Received → Dispatched → Delivered
   - Direct from supplier: PO → Confirmed → Dispatched → In transit → Delivered (supplier masked)
3. **Ten steps in four phases**, shown as a vertical timeline. Each step card has a mode badge (green "Automatic", amber "You decide", teal "Automatic + review queue" / "Manual today · automatic soon"), plus "Who:" and "Customer sees:" lines.
   - **Phase 1, Order and purchase order:** 1 The order comes in · 2 The PO goes to the supplier (with a no-login confirmation link and dedicated reply address)
   - **Phase 2, The supplier responds:** 3 Replies are captured (link or email, matched to the right PO) · 4 COAST reads and scores it (high confidence auto-applies; anything vaguer goes to the review queue) · 5 Mismatches are flagged (quantity, price, product code, date, partial confirmations)
   - **Phase 3, On the move:** 6 Tracking numbers become live shipments · 7 The delivery date keeps itself current (at-risk flag when it slips) · 8 Quiet suppliers and carriers get chased (escalating, logged)
   - **Phase 4, Delivered, and getting smarter:** 9 The customer gets an honest answer throughout (ranges until confirmed) · 10 Every order feeds the metrics (response rates, automation rate, overrides, supplier lateness)
4. **"How COAST decides" (dark panel):** H2 "Automatic when it's sure. Your call when it isn't." Two columns: High confidence → applied automatically; Medium or low → review queue.
5. **"Who sees what" table:** rows Admin, Procurement, Sales, Director (read-only), Customer; columns Orders, Supplier names & POs, Costs, Settings & team. Customer row reads "Their own / Never / Never / No".
6. **Closing CTA:** "See it with your own orders."

### 7.6 Website — Integrations & roadmap

1. **Hero:** H1 "Works with the carriers and systems you already use." Legend of status pills: ● Live (green) · ● Ready to connect (teal) · ● In development (amber) · ● Planned (grey).
2. **Carrier tracking (Live):** monogram tiles for DHL Express, FedEx, UPS, DPD, Royal Mail, TNT, Evri, Yodel. Note that some connections run in beta while official API access is confirmed.
3. **Systems, email and suppliers:** Supplier confirmation links (Live) · Supplier email reading (Live) · Microsoft 365 mailbox (Ready to connect) · NetSuite (In development) · Carrier aggregator (In development) · dark "Need something else? Request an integration →" card.
4. **Roadmap, three columns:**
   - Next up: NetSuite order sync · Structured delivery addresses · Your own sending domain
   - Later this year: Goods-In view · Director reporting view · Two-way order messaging
   - Exploring: Delivery map (continent to postcode) · Quote and pack · UK bank holiday awareness
   - Footnote: "Roadmap items are plans, not promises. Timings may change."

### 7.7 Website — Pricing, security & FAQ

1. **Hero:** H1 "Pay for the orders you track." Plans overlap the bottom of the hero.
2. **Three plans** (prices are placeholders):
   - Starter: up to [X] orders/month, [£ PRICE]. Order tracking, carrier tracking and chasing, customer tracking links, up to [X] users.
   - Growth (dark card, "Most popular"): everything in Starter plus supplier email reading and review queue, customer accounts and your branding, supplier performance metrics.
   - Scale: [X]+ orders, "Let's talk". Everything in Growth plus ERP integration (when live), director reporting view, unlimited users, onboarding support.
3. **Security & trust:** H2 "Your suppliers stay your business." Four cards: Masking in the data layer · Leak guard · Role-based access · Full audit trail.
4. **FAQ (expandable):** Does COAST replace our ERP? · Do our suppliers need an account? · Will customers ever see who our supplier is? · What happens when COAST is not sure about an email? · Which carriers do you support? · Does COAST use AI? (No: rule-based and traceable.)
5. **CTA band:** "Ready to stop chasing?"

### 7.8 Website — Sign in

One front door for everyone, on a Deep Sea background with a white card. Header has the lockup and "← Back to website".

- H1 "Welcome to COAST", sub "Choose how you'd like to sign in."
- Two tabs:
  - **My team:** "For staff using COAST: purchasing, sales, logistics and admin." Work email, password ("Forgotten it?"), button "Sign in to the app" → web app.
  - **Track an order:** "Ordered from a business that uses COAST? Check your delivery here. No account needed." Tracking code, delivery postcode, button "Track my order" → customer tracking page; divider "or"; secondary button "Sign in to your customer account".
- Footer line: "New to COAST? Register interest".

---

## 8. Content rules

- Don't advertise anything as live unless it is. Use the status labels from the Integrations page.
- Never imply customers can see supplier details. Masking is a core promise.
- Uncertain dates are always shown as ranges ("Estimated 14–17 October").
- No AI claims. Describe the system as "rule-based and traceable".
- Use placeholders like [Customer A], [£ PRICE] and [Rep name] rather than invented real-looking data.

---

## 9. Files in this pack

| File | What it is |
|---|---|
| `COAST-design-handoff.md` | This document |
| `logo/coast-mark.svg` | Mark for light backgrounds |
| `logo/coast-mark-white.svg` | Mark for dark backgrounds |
| `logo/coast-mark-512.png`, `-1024.png` (+ white versions) | Raster marks |
| `logo/coast-app-icon.svg` + 180/512/1024 PNG | App / PWA icons |
| `logo/coast-favicon.svg`, 16/32/48 PNG, `favicon.ico` | Favicon set |
| `mockups/*.dc.html` | Source files for every screen above (Design Component format; each is a self-contained page of inline-styled HTML, readable as a layout reference) |

Mockup file names: `Logo.dc.html` (final mark sheet), `App.dc.html`, `Customer.dc.html`, `Website.dc.html`, `HowItWorks.dc.html`, `Integrations.dc.html`, `Pricing.dc.html`, `SignIn.dc.html`.
