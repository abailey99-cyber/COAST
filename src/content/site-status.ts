/**
 * What the public website says is working (decision B3, readiness plan Task 1).
 *
 * THIS IS THE ONE PLACE TO CHANGE A STATUS. Every pill on the Integrations
 * page, the carrier answer in the FAQ and the roadmap come from here.
 *
 * The rule (handoff §8): never advertise anything as live unless it is.
 * - `status: "live"` or `"beta"` needs `verified: true`, meaning it has been
 *   tried end to end against a real account (a carrier, a mailbox, an ERP).
 *   The build fails otherwise (see `checkSiteStatus` below and its test).
 * - Every carrier stays "in_development" until the founder has seen it work
 *   on a real account.
 */

export const STATUSES = ["live", "beta", "in_development", "planned"] as const;
export type SiteStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<SiteStatus, string> = {
  live: "Live",
  beta: "Beta",
  in_development: "In development",
  planned: "Planned",
};

export interface Integration {
  key: string;
  name: string;
  /** Short monogram for the tile. */
  mono: string;
  note: string;
  status: SiteStatus;
  /** Seen working against a real account. Required for Live or Beta. */
  verified: boolean;
  /** Shown after the status, e.g. "Live (paste-in)". */
  qualifier?: string;
}

export const CARRIERS: readonly Integration[] = [
  { key: "dhl", mono: "DHL", name: "DHL Express", note: "Parcel and express", status: "in_development", verified: false },
  { key: "fedex", mono: "FX", name: "FedEx", note: "Parcel and express", status: "in_development", verified: false },
  { key: "tnt", mono: "TNT", name: "TNT", note: "Road and express", status: "in_development", verified: false },
  { key: "ups", mono: "UPS", name: "UPS", note: "Parcel and express", status: "in_development", verified: false },
  { key: "royal_mail", mono: "RM", name: "Royal Mail", note: "UK parcel and post", status: "in_development", verified: false },
  { key: "dpd", mono: "DPD", name: "DPD", note: "UK parcel", status: "in_development", verified: false },
  { key: "evri", mono: "EV", name: "Evri", note: "UK parcel", status: "in_development", verified: false },
  { key: "yodel", mono: "YO", name: "Yodel", note: "UK parcel", status: "in_development", verified: false },
];

export const SYSTEMS: readonly Integration[] = [
  {
    key: "supplier_links",
    mono: "✓",
    name: "Supplier confirmation links",
    note: "Suppliers confirm delivery dates from a no-login link on any device. There's nothing for them to install.",
    status: "live",
    // COAST's own feature: nothing outside COAST to connect.
    verified: true,
  },
  {
    key: "email_reading",
    mono: "@",
    name: "Supplier email reading",
    note: "Paste a supplier's reply into COAST and it's matched to the right PO, including UK trade phrasing like \"w/c\" and \"on back order\". Anything unclear goes to a person to check.",
    status: "live",
    qualifier: "paste-in",
    verified: true,
  },
  {
    key: "microsoft365",
    mono: "M365",
    name: "Microsoft 365 mailbox",
    note: "Read supplier replies from your purchasing inbox automatically, and send POs from it.",
    status: "in_development",
    verified: false,
  },
  {
    key: "netsuite",
    mono: "NS",
    name: "NetSuite",
    note: "Sales orders and POs sync straight from NetSuite, with no double entry.",
    status: "in_development",
    verified: false,
  },
  {
    key: "aggregator",
    mono: "+",
    name: "Carrier aggregator",
    note: "One connection covering many more carriers, including pallet networks.",
    status: "in_development",
    verified: false,
  },
];

export interface RoadmapItem {
  name: string;
  note: string;
}

/** Already in COAST (so the roadmap never lists built things as "coming"). */
export const RECENTLY_ADDED: readonly RoadmapItem[] = [
  { name: "Goods-in view", note: "See what's due into your warehouse and check deliveries in." },
  { name: "Director reporting view", note: "Read-only, company-wide visibility with supplier and order figures." },
  { name: "Order messaging", note: "Customers message you on their order; you reply from COAST." },
  { name: "Delivery problems", note: "Damaged, short or missing deliveries, with photos, worked through to a resolution." },
  { name: "Customs checklist", note: "The documents each cross-border shipment needs, and what's arrived." },
];

export const ROADMAP: { heading: string; items: readonly RoadmapItem[] }[] = [
  {
    heading: "Next up",
    items: [
      { name: "NetSuite order sync", note: "Orders and POs arrive automatically." },
      { name: "Automatic mailbox reading", note: "Supplier replies picked up without pasting them in." },
      { name: "Your own sending domain", note: "Supplier emails sent from your domain, properly authenticated." },
    ],
  },
  {
    heading: "Later this year",
    items: [
      { name: "More carriers", note: "Through one carrier aggregator." },
      { name: "Proof of delivery", note: "Delivery photos and signatures pulled in from carriers." },
      { name: "Branches and projects", note: "Split orders by selling branch, and group orders for one job." },
    ],
  },
  {
    heading: "Exploring",
    items: [
      { name: "Delivery map", note: "Where you ship, from continent down to postcode area." },
      { name: "Quote and pack", note: "Work out the boxes from item sizes, then get a carrier quote." },
      { name: "UK bank holiday awareness", note: "Dates and chase timers that skip bank holidays, not just weekends." },
    ],
  },
];

/** Pricing: the three plans stay hidden until prices are set; a founding-partner block shows instead. */
export const SHOW_PLANS = false;

/** The status a pill shows, e.g. "Live (paste-in)". */
export function statusText(i: Integration): string {
  return `${STATUS_LABELS[i.status]}${i.qualifier ? ` (${i.qualifier})` : ""}`;
}

/** Problems with the config: anything Live or Beta that hasn't been verified. Empty when it's safe to publish. */
export function checkSiteStatus(items: readonly Integration[] = [...CARRIERS, ...SYSTEMS]): string[] {
  return items.filter((i) => (i.status === "live" || i.status === "beta") && !i.verified).map((i) => `${i.name} is marked ${STATUS_LABELS[i.status]} but not verified`);
}

/** The carriers line in the FAQ, from the same list. */
export function carriersAnswer(): string {
  const live = CARRIERS.filter((c) => c.status === "live").map((c) => c.name);
  const building = CARRIERS.filter((c) => c.status !== "live").map((c) => c.name);
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  if (live.length === 0) {
    return `Connections for ${list(building)} are built and being verified against real carrier accounts, with more coming through a carrier aggregator. Until a carrier is verified you can update shipments by hand. See the Integrations page for current status.`;
  }
  return `${list(live)} today${building.length ? `, with ${list(building)} being verified` : ""}, and more coming through a carrier aggregator. See the Integrations page for current status.`;
}
