"use client";

import { useState, useTransition } from "react";
import { changeLineStage } from "@/server/order-actions";
import ui from "../../ui.module.css";

/** Move a line to another stage. Only the moves allowed by the rules are offered. */
export function StageSelect({
  lineId,
  lineNo,
  current,
  currentLabel,
  options,
}: {
  lineId: string;
  lineNo: number;
  current: string;
  currentLabel: string;
  options: { value: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <select
        className={ui.select}
        aria-label={`Stage for line ${lineNo}`}
        value={current}
        disabled={pending}
        onChange={(e) => {
          const to = e.target.value;
          if (to === "cancelled" && !window.confirm(`Cancel line ${lineNo}? This can't be undone.`)) return;
          setError(null);
          startTransition(async () => {
            const r = await changeLineStage(lineId, to);
            if (!r.ok) setError(r.error ?? "That didn't work.");
          });
        }}
      >
        <option value={current}>{currentLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === "cancelled" ? "Cancel this line" : `→ ${o.label}`}
          </option>
        ))}
      </select>
      {pending && <div className={ui.muted} role="status">Saving…</div>}
      {error && <div className={ui.fieldError} role="alert">{error}</div>}
    </div>
  );
}
