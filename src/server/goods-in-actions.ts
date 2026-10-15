"use server";

import { revalidatePath } from "next/cache";
import { listExpected, recordReceipt } from "@/lib/data/insight";
import { receiptOutcome, validateReceipt } from "@/lib/logic/goods-in";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { refreshPredictionsLater } from "./predictions";
import { draftGoodsInProblem } from "./problems-auto";
import { NotAllowedError, requirePermission } from "./session";

export interface GoodsInResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Check a delivery in at the warehouse (spec §5.6). */
export async function checkIn(lineId: string, _prev: GoodsInResult, formData: FormData): Promise<GoodsInResult> {
  try {
    await requirePermission("goods_in.check");
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, error: "The database isn't connected." };
    const line = (await listExpected(supabase)).find((l) => l.orderLineId === lineId);
    if (!line) return { ok: false, error: "That line isn't waiting to be checked in any more. Refresh the page." };
    const r = validateReceipt(
      { quantity: String(formData.get("quantity") ?? ""), condition: String(formData.get("condition") ?? ""), note: String(formData.get("note") ?? "") },
      line.quantity,
      line.receivedSoFar,
    );
    if (!r.ok) return { ok: false, error: r.error };
    const shipment = String(formData.get("shipment") ?? "");
    const shipmentId = line.tracking.some((t) => t.shipment_id === shipment) ? shipment : null;
    await recordReceipt(supabase, { lineId, quantity: r.value.quantity, condition: r.value.condition, note: r.value.note, shipmentId });
    // Warehouse staff can't read orders themselves; the line came from their own goods-in list.
    const admin = createSupabaseAdminClient();
    const { data: order } = admin ? await admin.from("order_lines").select("sales_order_id").eq("id", lineId).maybeSingle<{ sales_order_id: string }>() : { data: null };
    refreshPredictionsLater([order?.sales_order_id]);
    // Damaged, short or wrong: draft a delivery problem for someone to triage (spec §5.4).
    const problemId = admin
      ? await draftGoodsInProblem(admin, { orderLineId: lineId, condition: r.value.condition, quantity: r.value.quantity, note: r.value.note, shipmentId, expected: Math.max(line.quantity - line.receivedSoFar, 0) })
      : null;
    revalidatePath("/app/goods-in");
    revalidatePath("/app/home");
    if (problemId) revalidatePath("/app/problems");
    return { ok: true, message: `${line.soNumber} line ${line.lineNo}: ${receiptOutcome(r.value, line.quantity, line.receivedSoFar)}${problemId ? " A delivery problem has been opened for it." : ""}` };
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, error: e.message };
    if (e instanceof Error && e.message === "not-waiting") return { ok: false, error: "That line isn't waiting to be checked in any more. Refresh the page." };
    if (e instanceof Error && e.message === "not-allowed") return { ok: false, error: "You don't have permission to check deliveries in." };
    return { ok: false, error: "The delivery couldn't be recorded. Try again." };
  }
}
