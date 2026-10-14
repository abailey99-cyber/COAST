"use client";

import { useState } from "react";
import type { GoodsInLine } from "@/server/insight";
import ui from "../ui.module.css";
import { CheckInForm } from "./CheckInForm";

/**
 * The list of what's due in. The confirmation sits above the list, so it
 * stays on screen when a fully received line drops off it.
 */
export function GoodsInBoard({ lines, conditions }: { lines: GoodsInLine[]; conditions: { value: string; label: string }[] }) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section aria-label="Due in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {notice && (
        <p className="status status-ok" role="status" style={{ margin: 0 }}>
          ● {notice}
        </p>
      )}
      {lines.length === 0 ? (
        <div className={ui.panel}>
          <p className={ui.muted} style={{ margin: 0 }}>Nothing due in right now.</p>
        </div>
      ) : (
        lines.map((l) => (
          <article key={l.orderLineId} className={ui.panel} aria-labelledby={`gi-${l.orderLineId}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 id={`gi-${l.orderLineId}`} style={{ fontSize: 16 }}>
                {l.description} <span className={ui.muted}>× {l.outstanding}{l.receivedSoFar > 0 ? ` still to come (of ${l.quantity})` : ""}</span>
              </h2>
              <span className={`status ${l.late ? "status-warn" : "status-neutral"}`}>● {l.late ? "Late · " : ""}Expected {l.expected}</span>
            </div>
            <div className={ui.muted} style={{ fontSize: 13 }}>
              For {l.soNumber} line {l.lineNo} · {l.customerName}
              {l.sku ? ` · ${l.sku}` : ""}
              {l.poNumber ? ` · ${l.poNumber}` : ""}
              {l.supplierName ? ` from ${l.supplierName}` : ""}
              {l.inboundShipments.length > 0 ? ` · ${l.inboundShipments.map((s) => s.label).join(", ")}` : ""}
            </div>
            <CheckInForm lineId={l.orderLineId} outstanding={l.outstanding} conditions={conditions} shipments={l.inboundShipments} onDone={setNotice} />
          </article>
        ))
      )}
    </section>
  );
}
