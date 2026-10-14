"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DuplicateError, createOrder, getLineForStageChange, getOrder, updateLineStage, updateOrder } from "@/lib/data/orders";
import { createPurchaseOrder, createSupplier, getPoStatus, updatePoStatus } from "@/lib/data/procurement";
import { listStaffInOrg } from "@/lib/data/staff";
import { canMoveStage, isLineStage, validateNewOrder, validateOrderEdit, type EditOrderInput, type FieldErrors, type NewOrderInput } from "@/lib/logic/orders";
import { hasPermission } from "@/lib/logic/permissions";
import { allowedPoStatusChanges, validateNewPo, validateNewSupplier, type PoStatus } from "@/lib/logic/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotAllowedError, requirePermission, requireStaffForAction } from "./session";
import { refreshPredictionsForPoLater, refreshPredictionsLater } from "./predictions";

export interface ActionState {
  error?: string;
  fieldErrors?: FieldErrors;
  message?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function failure(e: unknown, fallback: string): ActionResult {
  if (e instanceof NotAllowedError || e instanceof DuplicateError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

// ── New order ───────────────────────────────────────────────────────────────
export async function createOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let orderId: string;
  try {
    const staff = await requirePermission("orders.edit");
    const count = Math.min(Number(field(formData, "lineCount")) || 0, 200);
    const input: NewOrderInput = {
      customerName: field(formData, "customerName"),
      customerReference: field(formData, "customerReference"),
      soNumber: field(formData, "soNumber"),
      salesRepId: field(formData, "salesRepId"),
      currency: field(formData, "currency"),
      promisedDate: field(formData, "promisedDate"),
      deliveryName: field(formData, "deliveryName"),
      deliveryLine1: field(formData, "deliveryLine1"),
      deliveryLine2: field(formData, "deliveryLine2"),
      deliveryTown: field(formData, "deliveryTown"),
      deliveryPostcode: field(formData, "deliveryPostcode"),
      deliveryCountry: field(formData, "deliveryCountry"),
      lines: Array.from({ length: count }, (_, i) => ({
        sku: field(formData, `lines.${i}.sku`),
        description: field(formData, `lines.${i}.description`),
        quantity: field(formData, `lines.${i}.quantity`),
        unitPrice: field(formData, `lines.${i}.unitPrice`),
        route: field(formData, `lines.${i}.route`),
      })),
    };
    const result = validateNewOrder(input);
    if (!result.ok) return { error: "Please check the highlighted fields.", fieldErrors: result.errors };

    const supabase = await client();
    if (result.order.salesRepId) {
      const team = await listStaffInOrg(supabase);
      if (!team.some((p) => p.id === result.order.salesRepId && p.isActive)) {
        return { error: "Please check the highlighted fields.", fieldErrors: { salesRepId: "Choose someone from your team." } };
      }
    }
    // A sales rep who can't see everyone's orders must be the rep on orders they create, or they'd lose sight of them.
    if (!hasPermission(staff.permissions, "orders.view_all") && result.order.salesRepId !== staff.id) {
      return { error: "Please check the highlighted fields.", fieldErrors: { salesRepId: "You can only create orders for yourself." } };
    }
    orderId = await createOrder(supabase, result.order);
  } catch (e) {
    if (e instanceof DuplicateError) return { error: "Please check the highlighted fields.", fieldErrors: { soNumber: e.message } };
    if (e instanceof NotAllowedError) return { error: e.message };
    return { error: "The order couldn't be saved. Try again." };
  }
  refreshPredictionsLater([orderId]);
  revalidatePath("/app/orders");
  redirect(`/app/orders/${orderId}`);
}

// ── Stage changes ───────────────────────────────────────────────────────────
export async function changeLineStage(lineId: string, to: string): Promise<ActionResult> {
  try {
    const staff = await requireStaffForAction();
    if (!hasPermission(staff.permissions, "orders.edit") && !hasPermission(staff.permissions, "procurement.manage")) throw new NotAllowedError();
    if (!isLineStage(to)) return { ok: false, error: "Unknown stage." };
    const supabase = await client();
    const line = await getLineForStageChange(supabase, lineId);
    if (!line) return { ok: false, error: "That line isn't available." };
    if (!canMoveStage(line.stage, to, line.route)) return { ok: false, error: "That stage change isn't allowed." };
    const changed = await updateLineStage(supabase, lineId, line.stage, to);
    if (!changed) return { ok: false, error: "Someone else just changed this line. Refresh and try again." };
    refreshPredictionsLater([line.salesOrderId]);
    revalidatePath(`/app/orders/${line.salesOrderId}`);
    revalidatePath("/app/orders");
    return { ok: true };
  } catch (e) {
    return failure(e, "The stage couldn't be changed. Try again.");
  }
}

// ── Suppliers ───────────────────────────────────────────────────────────────
export async function createSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const staff = await requirePermission("procurement.manage");
    if (!hasPermission(staff.permissions, "supplier.identity.view")) throw new NotAllowedError();
    const result = validateNewSupplier({
      name: field(formData, "name"),
      email: field(formData, "email"),
      phone: field(formData, "phone"),
      currency: field(formData, "currency"),
      leadTimeDays: field(formData, "leadTimeDays"),
    });
    if (!result.ok) return { error: "Please check the highlighted fields.", fieldErrors: result.errors };
    await createSupplier(await client(), staff.orgId, result.supplier);
    revalidatePath("/app/suppliers");
    return { message: `${result.supplier.name} added.` };
  } catch (e) {
    if (e instanceof DuplicateError) return { error: "Please check the highlighted fields.", fieldErrors: { name: e.message } };
    if (e instanceof NotAllowedError) return { error: e.message };
    return { error: "The supplier couldn't be saved. Try again." };
  }
}

// ── Purchase orders ─────────────────────────────────────────────────────────
export async function createPoAction(orderId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  let poId: string;
  try {
    const staff = await requirePermission("procurement.manage");
    if (!hasPermission(staff.permissions, "supplier.identity.view")) throw new NotAllowedError();
    const supabase = await client();
    const order = await getOrder(supabase, orderId);
    if (!order) return { error: "That order isn't available." };

    const chosen = formData.getAll("line").filter((v): v is string => typeof v === "string");
    const result = validateNewPo(
      {
        supplierId: field(formData, "supplierId"),
        currency: field(formData, "currency"),
        lines: chosen.map((id) => ({
          orderLineId: id,
          quantity: field(formData, `qty.${id}`),
          unitCost: field(formData, `cost.${id}`),
          requestedDate: field(formData, `date.${id}`),
        })),
      },
      order.lines.map((l) => ({ id: l.id, route: l.route, stage: l.stage, quantity: l.quantity, onLivePo: l.poLinks.some((p) => p.status !== "cancelled") })),
      hasPermission(staff.permissions, "costs.view"),
    );
    if (!result.ok) {
      // Errors come back by position among the ticked lines; the form shows them by line id.
      const byLine: FieldErrors = {};
      for (const [key, message] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)(.*)$/.exec(key);
        const id = m ? chosen[Number(m[1])] : undefined;
        byLine[id ? `line.${id}${m![2]}` : key] = message;
      }
      return { error: "Please check the highlighted fields.", fieldErrors: byLine };
    }
    poId = await createPurchaseOrder(supabase, result.po);
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: e.message };
    return { error: "The purchase order couldn't be saved. Try again." };
  }
  refreshPredictionsLater([orderId]);
  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath("/app/purchase-orders");
  redirect(`/app/purchase-orders/${poId}`);
}

export async function changePoStatus(poId: string, to: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("procurement.manage");
    if (!hasPermission(staff.permissions, "supplier.identity.view")) throw new NotAllowedError();
    const supabase = await client();
    const from = await getPoStatus(supabase, poId);
    if (!from) return { ok: false, error: "That purchase order isn't available." };
    if (!allowedPoStatusChanges(from).includes(to as PoStatus)) return { ok: false, error: "That status change isn't allowed." };
    const changed = await updatePoStatus(supabase, poId, from, to as PoStatus);
    if (!changed) return { ok: false, error: "Someone else just changed this purchase order. Refresh and try again." };
    refreshPredictionsForPoLater(supabase, poId);
    revalidatePath(`/app/purchase-orders/${poId}`);
    revalidatePath("/app/purchase-orders");
    revalidatePath("/app/orders", "layout");
    return { ok: true };
  } catch (e) {
    return failure(e, "The status couldn't be changed. Try again.");
  }
}

// ── Editing an order ────────────────────────────────────────────────────────
export async function updateOrderAction(orderId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const staff = await requirePermission("orders.edit");
    const supabase = await client();
    const order = await getOrder(supabase, orderId);
    if (!order) return { error: "That order isn't available." };

    const lineIds = formData.getAll("lineId").filter((v): v is string => typeof v === "string");
    const newCount = Math.min(Number(field(formData, "newLineCount")) || 0, 200);
    const input: EditOrderInput = {
      customerName: field(formData, "customerName"),
      customerReference: field(formData, "customerReference"),
      salesRepId: field(formData, "salesRepId"),
      currency: field(formData, "currency"),
      promisedDate: field(formData, "promisedDate"),
      deliveryName: field(formData, "deliveryName"),
      deliveryLine1: field(formData, "deliveryLine1"),
      deliveryLine2: field(formData, "deliveryLine2"),
      deliveryTown: field(formData, "deliveryTown"),
      deliveryPostcode: field(formData, "deliveryPostcode"),
      deliveryCountry: field(formData, "deliveryCountry"),
      lines: lineIds.map((id) => ({
        id,
        sku: field(formData, `line.${id}.sku`),
        description: field(formData, `line.${id}.description`),
        quantity: field(formData, `line.${id}.quantity`),
        unitPrice: field(formData, `line.${id}.unitPrice`),
      })),
      newLines: Array.from({ length: newCount }, (_, i) => ({
        sku: field(formData, `newLines.${i}.sku`),
        description: field(formData, `newLines.${i}.description`),
        quantity: field(formData, `newLines.${i}.quantity`),
        unitPrice: field(formData, `newLines.${i}.unitPrice`),
        route: field(formData, `newLines.${i}.route`),
      })),
    };
    const result = validateOrderEdit(
      input,
      order.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        stage: l.stage,
        quantityOnLivePos: l.poLinks.filter((p) => p.status !== "cancelled").reduce((s, p) => s + p.quantity, 0),
      })),
    );
    if (!result.ok) return { error: "Please check the highlighted fields.", fieldErrors: result.errors };

    if (result.edit.salesRepId && result.edit.salesRepId !== order.salesRepId) {
      const team = await listStaffInOrg(supabase);
      if (!team.some((p) => p.id === result.edit.salesRepId && p.isActive)) {
        return { error: "Please check the highlighted fields.", fieldErrors: { salesRepId: "Choose someone from your team." } };
      }
    }
    if (!hasPermission(staff.permissions, "orders.view_all") && result.edit.salesRepId !== staff.id) {
      return { error: "Please check the highlighted fields.", fieldErrors: { salesRepId: "You can only keep orders assigned to yourself." } };
    }
    await updateOrder(supabase, orderId, result.edit);
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: e.message };
    return { error: "The changes couldn't be saved. Try again." };
  }
  refreshPredictionsLater([orderId]);
  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath("/app/orders");
  redirect(`/app/orders/${orderId}`);
}
