"use client";

import { useState, useTransition } from "react";
import { changePoStatus } from "@/server/order-actions";
import ui from "../../ui.module.css";

const VERB: Record<string, string> = {
  sent: "Mark as sent",
  confirmed: "Mark as confirmed by supplier",
  cancelled: "Cancel this PO",
};

export function PoStatusButtons({ poId, options }: { poId: string; options: { value: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={ui.actions}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === "cancelled" ? "btn btn-secondary" : "btn btn-primary"}
          disabled={pending}
          onClick={() => {
            if (o.value === "cancelled" && !window.confirm("Cancel this purchase order? Its lines go back to needing a PO.")) return;
            setError(null);
            startTransition(async () => {
              const r = await changePoStatus(poId, o.value);
              if (!r.ok) setError(r.error ?? "That didn't work.");
            });
          }}
        >
          {VERB[o.value] ?? o.label}
        </button>
      ))}
      {pending && <span className={ui.muted} role="status">Saving…</span>}
      {error && <span className={ui.fieldError} role="alert">{error}</span>}
    </div>
  );
}
