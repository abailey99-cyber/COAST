"use client";

import { useState, useTransition } from "react";
import { undoAutomaticDate, type InboundResult } from "@/server/inbound-actions";
import ui from "../../ui.module.css";

/** One click to put back a date that applied itself from a supplier's email (readiness Task 3). */
export function UndoAutomaticDate({ responseId, highlight }: { responseId: string; highlight: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InboundResult | null>(null);
  if (result?.ok) return <p className="status status-ok" role="status" style={{ margin: "6px 0 0" }}>● {result.message}</p>;
  return (
    <div id={`undo-${responseId}`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6, ...(highlight ? { outline: "2px solid var(--coast-tide-teal)", borderRadius: 8, padding: 6 } : {}) }}>
      <span className={ui.muted}>Applied automatically from the supplier&apos;s email.</span>
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => startTransition(async () => setResult(await undoAutomaticDate(responseId)))}>
        {pending ? "Undoing…" : "Undo"}
      </button>
      {result && !result.ok && <span className={ui.fieldError} role="alert">{result.error}</span>}
    </div>
  );
}
