"use server";

import { refreshPredictionsLater } from "./predictions";
import { getPurchaseOrder } from "@/lib/data/procurement";
import { validateLinkAnswer } from "@/lib/logic/supplier-response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveLink } from "./confirm-page";
import { hitRateLimit } from "@/lib/data/customer-portal";
import { visitorKey } from "./customer-view";
import { poLinesForCheck, processSupplierAnswer } from "./supplier-loop";

export interface ConfirmState {
  done?: "applied" | "needs_review";
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * A supplier submits their answer through the no-login link. Re-checks the
 * link (it may have been revoked or expired since the page loaded), then the
 * answer takes the same path as every other supplier answer.
 * Rate-limited per visitor (readiness Task 5B); the link code is 256
 * random bits, so guessing one isn't practical either.
 */
export async function submitSupplierConfirmation(token: string, _prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  try {
    const limiter = createSupabaseAdminClient();
    if (limiter && !(await hitRateLimit(limiter, `confirm-send:${await visitorKey()}`, 20, 3600))) return { error: "Too many tries. Please wait a while, or reply to the email instead." };
    const { state, view } = await resolveLink(token, new Date());
    if (state !== "open" || !view) return { error: "This link no longer works. Please reply to the purchase order email instead." };
    const admin = createSupabaseAdminClient();
    if (!admin) return { error: "Confirmation isn't available right now. Please reply to the email instead." };
    const po = await getPurchaseOrder(admin, view.purchaseOrderId);
    if (!po) return { error: "This purchase order isn't available." };

    const check = { lines: poLinesForCheck(po) };
    const result = validateLinkAnswer(
      po.lines.map((l) => ({
        poLineId: l.id,
        available: formData.get(`cannot.${l.id}`) !== "on",
        quantity: String(formData.get(`quantity.${l.id}`) ?? ""),
        date: String(formData.get(`date.${l.id}`) ?? ""),
        unitPrice: String(formData.get(`price.${l.id}`) ?? ""),
      })),
      check,
    );
    if (!result.ok) return { error: "Please check the highlighted lines.", fieldErrors: result.errors };

    const outcome = await processSupplierAnswer(admin, {
      orgId: view.orgId,
      po,
      source: "link",
      rawText: null,
      answer: result.answer,
      confidence: "high",
      extraReasons: [],
      extras: {
        supplierReference: String(formData.get("reference") ?? "").trim().slice(0, 100) || undefined,
        note: String(formData.get("note") ?? "").trim().slice(0, 2000) || undefined,
      },
      linkId: view.linkId,
      includePrices: true,
    });
    refreshPredictionsLater(po.lines.map((l) => l.orderId));
    return { done: outcome.outcome };
  } catch (e) {
    console.error("[confirm] couldn't save a supplier answer", e instanceof Error ? e.message : e);
    return { error: "Your answer couldn't be saved. Please try again, or reply to the email instead." };
  }
}
