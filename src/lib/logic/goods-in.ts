/**
 * Checking deliveries in at the warehouse (spec §5.6 Goods-in). Pure.
 */

export const CONDITIONS = ["ok", "short", "damaged", "wrong_item"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  ok: "All here, good condition",
  short: "Fewer than expected",
  damaged: "Damaged",
  wrong_item: "Wrong item",
};

export function isCondition(v: unknown): v is Condition {
  return typeof v === "string" && (CONDITIONS as readonly string[]).includes(v);
}

export interface ReceiptInput {
  quantity: string;
  condition: string;
  note: string;
}

export interface ValidReceipt {
  quantity: number;
  condition: Condition;
  note: string | null;
}

/**
 * A check-in. "All here" means the rest of what's outstanding; "fewer"
 * needs the count; damaged or wrong items need a note so someone can act.
 */
export function validateReceipt(i: ReceiptInput, ordered: number, receivedSoFar: number): { ok: true; value: ValidReceipt } | { ok: false; error: string } {
  if (!isCondition(i.condition)) return { ok: false, error: "Choose what arrived." };
  const outstanding = Math.max(0, ordered - receivedSoFar);
  const note = i.note.trim().slice(0, 1000) || null;
  const text = i.quantity.trim();
  let quantity = text === "" ? NaN : Number(text);

  if (i.condition === "ok") {
    quantity = text === "" ? outstanding : quantity;
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: "Enter how many arrived." };
    if (quantity < outstanding) return { ok: false, error: `That's fewer than the ${outstanding} expected — choose "Fewer than expected".` };
  } else if (i.condition === "short") {
    if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, error: "Enter how many arrived." };
    if (quantity >= outstanding) return { ok: false, error: `That's all ${outstanding} expected — choose "All here".` };
  } else {
    if (!Number.isFinite(quantity) || quantity < 0) quantity = 0;
    if (!note) return { ok: false, error: "Say what's wrong, so someone can sort it out." };
  }
  if (quantity > 1_000_000 || Math.round(quantity * 1000) !== quantity * 1000) return { ok: false, error: "That quantity doesn't look right." };
  return { ok: true, value: { quantity, condition: i.condition, note } };
}

/** What a check-in does to the line, in words, before anyone presses the button. */
export function receiptOutcome(r: ValidReceipt, ordered: number, receivedSoFar: number): string {
  const total = receivedSoFar + (r.condition === "ok" || r.condition === "short" ? r.quantity : 0);
  if (r.condition === "damaged") return "Recorded as damaged. The line stays waiting until good stock arrives.";
  if (r.condition === "wrong_item") return "Recorded as the wrong item. The line stays waiting until the right one arrives.";
  if (total >= ordered) return "The line is now Received and ready to go out.";
  return `${total} of ${ordered} received so far. The line stays waiting for the rest.`;
}
