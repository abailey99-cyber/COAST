import "server-only";
import { getLinkView, touchLink, type SupplierLinkView } from "@/lib/data/supplier-loop";
import { formatDateTime, formatIsoDate, formatMoney, formatQuantity } from "@/lib/logic/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken, isWellFormedToken } from "./tokens";
import { hitRateLimit } from "@/lib/data/customer-portal";
import { visitorKey } from "./customer-view";
import { linkState, type LinkState } from "@/lib/logic/supplier-link";

/**
 * The supplier's no-login confirmation page (spec §5.1, §7.1). Looked up by
 * the hash of the link code only. Nothing here identifies the buyer's
 * customer beyond the delivery address for direct-ship lines.
 */

export type { LinkState };

export interface ConfirmPage {
  /** "busy": too many tries from this visitor; try later. */
  state: LinkState | "busy";
  view?: {
    poNumber: string;
    buyerName: string;
    supplierName: string;
    currency: string;
    expires: string;
    lastAnswer: string | null;
    confirmed: boolean;
    lines: {
      poLineId: string;
      description: string;
      sku: string | null;
      quantity: string;
      quantityValue: number;
      requested: string;
      requestedIso: string;
      price: string | null;
      priceValue: string;
      confirmed: string | null;
      deliverTo: string | null;
    }[];
  };
}

/** Works out whether a link can be used, as of `now`. */
export async function resolveLink(token: string, now: Date): Promise<{ state: LinkState; view?: SupplierLinkView }> {
  if (!isWellFormedToken(token)) return { state: "invalid" };
  const admin = createSupabaseAdminClient();
  if (!admin) return { state: "unavailable" };
  const view = await getLinkView(admin, hashLinkToken(token));
  if (!view) return { state: "invalid" };
  // Opening a link never uses it up (an email scanner opening it first changes nothing): only "Send confirmation" does.
  return { state: linkState(view, now), view };
}

/**
 * Opening the link. Rate-limited per visitor, and wrong codes are limited
 * harder, so guessing is pointless (the code is 256 random bits anyway).
 * Opening never uses the link up: only "Send confirmation" does.
 */
export async function loadConfirmPage(token: string): Promise<ConfirmPage> {
  const limiter = createSupabaseAdminClient();
  const who = await visitorKey();
  if (limiter && !(await hitRateLimit(limiter, `confirm-open:${who}`, 60, 600))) return { state: "busy" };
  const { state, view } = await resolveLink(token, new Date());
  if (limiter && state === "invalid" && !(await hitRateLimit(limiter, `confirm-miss:${who}`, 15, 600))) return { state: "busy" };
  if (!view || state === "invalid" || state === "unavailable") return { state };
  if (state === "open") {
    const admin = createSupabaseAdminClient();
    if (admin) await touchLink(admin, view.linkId);
  }
  return {
    state,
    view: {
      poNumber: view.poNumber,
      buyerName: view.buyerName,
      supplierName: view.supplierName,
      currency: view.currency,
      expires: formatDateTime(new Date(view.expiresAt)),
      lastAnswer: view.lastAnswerAt ? formatDateTime(new Date(view.lastAnswerAt)) : null,
      confirmed: view.poStatus === "confirmed",
      lines: view.lines.map((l) => ({
        poLineId: l.poLineId,
        description: l.description,
        sku: l.sku,
        quantity: formatQuantity(l.quantity),
        quantityValue: l.quantity,
        requested: formatIsoDate(l.requestedDate),
        requestedIso: l.requestedDate ?? "",
        price: l.unitCostMinor === null ? null : formatMoney(l.unitCostMinor, view.currency),
        priceValue: l.unitCostMinor === null ? "" : (l.unitCostMinor / 100).toFixed(2),
        confirmed: l.confirmedDate ? formatIsoDate(l.confirmedDate) : null,
        deliverTo: l.deliverTo,
      })),
    },
  };
}
