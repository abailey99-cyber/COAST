"use server";

import { revalidatePath } from "next/cache";
import { getOrder } from "@/lib/data/orders";
import { addReplacementLine, getProblem, insertProblem, insertProblemEvent, insertProblemNote, updateProblem, type ProblemPatch } from "@/lib/data/problems";
import { getShipment, listCarrierSettings } from "@/lib/data/shipments";
import { listStaffInOrg } from "@/lib/data/staff";
import { isCarrierKey } from "@/lib/logic/carriers";
import { ukDateOf, ukToday } from "@/lib/logic/prediction";
import { RESOLUTION_LABELS, STATUS_LABELS, claimDeadline, isCategory, isProblemStatus, isResolution, nextStatuses, validateReport } from "@/lib/logic/problems";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyCustomerLater } from "./notifications";
import { readPhotos, savePhotos } from "./problem-photos";
import { refreshPredictionsLater } from "./predictions";
import { NotAllowedError, requirePermission } from "./session";

/** Staff actions on delivery problems (spec §5.4). Permission first; RLS checks again. */

export interface ProblemResult {
  ok: boolean;
  error?: string;
  message?: string;
  problemId?: string;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function failure(e: unknown, fallback: string): ProblemResult {
  if (e instanceof NotAllowedError) return { ok: false, error: e.message };
  console.warn("[problems]", e instanceof Error ? e.message : e);
  return { ok: false, error: fallback };
}

function revalidate(problemId: string, orderId: string) {
  revalidatePath(`/app/problems/${problemId}`);
  revalidatePath("/app/problems");
  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath("/app/home");
  revalidatePath("/app/chases");
}

const text = (v: FormDataEntryValue | null, max = 2000) => String(v ?? "").trim().slice(0, max) || null;

/** Report a problem on an order, from the order page. */
export async function reportProblem(orderId: string, _prev: ProblemResult | null, formData: FormData): Promise<ProblemResult> {
  try {
    const staff = await requirePermission("problems.manage");
    const supabase = await client();
    const order = await getOrder(supabase, orderId);
    if (!order) return { ok: false, error: "That order isn't available." };
    const r = validateReport(
      { category: String(formData.get("category") ?? ""), description: String(formData.get("description") ?? ""), lineIds: formData.getAll("lines").map(String) },
      order.lines.map((l) => l.id),
    );
    if (!r.ok) return { ok: false, error: r.error };
    const photos = await readPhotos(formData);
    if (!photos.ok) return { ok: false, error: photos.error };

    const shipmentId = String(formData.get("shipment") ?? "");
    const shipment = shipmentId ? await getShipment(supabase, shipmentId) : null;
    if (shipment && shipment.salesOrderId !== orderId) return { ok: false, error: "That shipment isn't on this order." };
    let deadline: string | null = null;
    if (shipment && isCarrierKey(shipment.carrier)) {
      const window = (await listCarrierSettings(supabase))[shipment.carrier]?.claimWindowDays ?? null;
      deadline = claimDeadline(window, shipment.deliveredAt ? ukDateOf(shipment.deliveredAt) : ukToday(new Date()));
    }
    const id = await insertProblem(supabase, {
      orgId: staff.orgId,
      orderId,
      shipmentId: shipment?.id ?? null,
      raisedVia: "staff",
      category: r.value.category,
      description: r.value.description,
      reporterName: staff.fullName,
      claimDeadline: deadline,
      lines: r.value.lineIds.map((l) => ({ orderLineId: l, quantity: null })),
    });
    const admin = createSupabaseAdminClient();
    const saved = admin && photos.photos.length > 0 ? await savePhotos(admin, staff.orgId, id, photos.photos, { kind: "staff", userId: staff.id }) : 0;
    revalidate(id, orderId);
    const lost = photos.photos.length - saved;
    return { ok: true, problemId: id, message: `Problem reported.${lost > 0 ? ` ${lost} photo${lost === 1 ? "" : "s"} couldn't be stored — add ${lost === 1 ? "it" : "them"} from the problem page.` : ""}` };
  } catch (e) {
    return failure(e, "The problem couldn't be reported. Try again.");
  }
}

/**
 * Move a problem on. Resolving needs a resolution; a replacement adds a new
 * line to the order (once). A customer who reported it hears the new
 * customer-safe status.
 */
export async function changeProblemStatus(problemId: string, _prev: ProblemResult | null, formData: FormData): Promise<ProblemResult> {
  try {
    const staff = await requirePermission("problems.manage");
    const supabase = await client();
    const p = await getProblem(supabase, problemId);
    if (!p) return { ok: false, error: "That problem isn't available." };
    const to = String(formData.get("status") ?? "");
    if (!isProblemStatus(to) || !nextStatuses(p.status).includes(to)) return { ok: false, error: "Choose where it goes next." };

    const patch: ProblemPatch = { status: to };
    let replacementNote: string | null = null;
    if (to === "resolved") {
      const resolution = String(formData.get("resolution") ?? "");
      if (!isResolution(resolution)) return { ok: false, error: "Choose how it was resolved." };
      patch.resolution = resolution;
      patch.resolutionNote = text(formData.get("resolutionNote"));
      patch.rmaReference = text(formData.get("rma"), 100);
      if (resolution === "replacement" && !p.replacementLineId && p.lines[0]) {
        // Adding a line to someone's order is order editing, so the system does it after the check above.
        const admin = createSupabaseAdminClient();
        const added = admin ? await addReplacementLine(admin, p.lines[0].orderLineId, p.lines[0].quantity) : null;
        if (added) {
          patch.replacementLineId = added.id;
          replacementNote = `Replacement added to the order as line ${added.lineNo}`;
        }
      }
    } else if (to === "closed" && !p.resolution) {
      const resolution = String(formData.get("resolution") ?? "");
      if (isResolution(resolution)) patch.resolution = resolution;
    } else if (to === "triage" && (p.status === "resolved" || p.status === "closed")) {
      // Reopened: the old outcome no longer stands.
      patch.resolution = null;
    }
    if (!(await updateProblem(supabase, problemId, patch))) return { ok: false, error: "You can't change that problem." };

    const admin = createSupabaseAdminClient();
    if (admin && patch.resolution && to === "resolved") {
      const how = `Resolved: ${RESOLUTION_LABELS[patch.resolution].toLowerCase()}${patch.rmaReference ? ` (RMA ${patch.rmaReference})` : ""}${patch.resolutionNote ? ` — ${patch.resolutionNote}` : ""}`;
      await insertProblemEvent(admin, problemId, "resolution", { text: replacementNote ? `${how}. ${replacementNote}.` : how }, staff.id);
    }
    if (p.raisedVia === "customer") notifyCustomerLater(p.salesOrderId, "problem_update");
    if (patch.replacementLineId) refreshPredictionsLater([p.salesOrderId]);
    revalidate(problemId, p.salesOrderId);
    return { ok: true, message: `Now: ${STATUS_LABELS[to]}.${replacementNote ? ` ${replacementNote}.` : ""}` };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

export async function assignProblem(problemId: string, ownerId: string): Promise<ProblemResult> {
  try {
    await requirePermission("problems.manage");
    const supabase = await client();
    const p = await getProblem(supabase, problemId);
    if (!p) return { ok: false, error: "That problem isn't available." };
    if (ownerId && !(await listStaffInOrg(supabase)).some((s) => s.id === ownerId && s.isActive)) return { ok: false, error: "Choose someone on the team." };
    if (!(await updateProblem(supabase, problemId, { ownerId: ownerId || null }))) return { ok: false, error: "You can't change that problem." };
    revalidate(problemId, p.salesOrderId);
    return { ok: true, message: ownerId ? "Assigned." : "Unassigned." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

/** The internal detail: category, root cause, RMA, claim deadline and whether the claim's in. */
export async function saveProblemDetails(problemId: string, _prev: ProblemResult | null, formData: FormData): Promise<ProblemResult> {
  try {
    await requirePermission("problems.manage");
    const supabase = await client();
    const p = await getProblem(supabase, problemId);
    if (!p) return { ok: false, error: "That problem isn't available." };
    const category = String(formData.get("category") ?? "");
    if (!isCategory(category)) return { ok: false, error: "Choose what's wrong." };
    const deadline = String(formData.get("claimDeadline") ?? "").trim();
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { ok: false, error: "Enter the claim deadline as a date." };
    const submitted = formData.get("claimSubmitted") === "on";
    const ok = await updateProblem(supabase, problemId, {
      category,
      rootCause: text(formData.get("rootCause")),
      rmaReference: text(formData.get("rma"), 100),
      claimDeadline: deadline || null,
      claimSubmittedAt: submitted ? (p.claimSubmittedAt ?? new Date().toISOString()) : null,
    });
    if (!ok) return { ok: false, error: "You can't change that problem." };
    revalidate(problemId, p.salesOrderId);
    return { ok: true, message: "Saved." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

export async function addProblemNote(problemId: string, _prev: ProblemResult | null, formData: FormData): Promise<ProblemResult> {
  try {
    const staff = await requirePermission("problems.manage");
    const note = text(formData.get("note"), 2000);
    if (!note) return { ok: false, error: "Write the note first." };
    const supabase = await client();
    const p = await getProblem(supabase, problemId);
    if (!p) return { ok: false, error: "That problem isn't available." };
    await insertProblemNote(supabase, problemId, staff.id, note);
    revalidate(problemId, p.salesOrderId);
    return { ok: true, message: "Note added. Notes stay internal — customers never see them." };
  } catch (e) {
    return failure(e, "The note couldn't be added. Try again.");
  }
}

export async function addProblemPhotos(problemId: string, _prev: ProblemResult | null, formData: FormData): Promise<ProblemResult> {
  try {
    const staff = await requirePermission("problems.manage");
    const supabase = await client();
    const p = await getProblem(supabase, problemId);
    if (!p) return { ok: false, error: "That problem isn't available." };
    const photos = await readPhotos(formData, p.photoCount);
    if (!photos.ok) return { ok: false, error: photos.error };
    if (photos.photos.length === 0) return { ok: false, error: "Choose a photo first." };
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "Photo storage isn't connected." };
    const saved = await savePhotos(admin, p.orgId, problemId, photos.photos, { kind: "staff", userId: staff.id });
    revalidate(problemId, p.salesOrderId);
    if (saved === 0) return { ok: false, error: "The photos couldn't be stored. Try again." };
    return { ok: true, message: `${saved} photo${saved === 1 ? "" : "s"} added.` };
  } catch (e) {
    return failure(e, "The photos couldn't be added. Try again.");
  }
}
