"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { withShrunkPhotos } from "@/components/photos";
import { reportProblem, type ProblemResult } from "@/server/problem-actions";
import type { OrderProblems } from "@/server/problems";
import { LEVEL_CLASS } from "../../problems/level";
import ui from "../../ui.module.css";

/** The order page's Delivery problems panel: what's been reported, and reporting one. */
export function OrderProblemsPanel({ orderId, data }: { orderId: string; data: OrderProblems }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={ui.panel} aria-labelledby="problems-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h2 id="problems-title" style={{ fontSize: 16 }}>Delivery problems</h2>
        {data.canReport && !open && (
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>Report a problem</button>
        )}
      </div>
      {data.items.length === 0 ? (
        <p className={ui.muted} style={{ margin: 0 }}>None reported.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {data.items.map((p) => (
            <li key={p.id} style={{ fontSize: 13 }}>
              <Link href={`/app/problems/${p.id}`} className={ui.rowLink}>{p.what}</Link>
              <span className={ui.muted}> · {p.lines} · {p.via} · {p.raised}</span>
              <div>
                <span className={`status ${p.open ? LEVEL_CLASS[p.level] : "status-ok"}`}>● {p.status}</span>
                {p.claim && <span className={`status ${LEVEL_CLASS[p.claim.level]}`} style={{ marginLeft: 8 }}>● {p.claim.label}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <ReportForm orderId={orderId} data={data} onDone={() => setOpen(false)} />}
    </section>
  );
}

function ReportForm({ orderId, data, onDone }: { orderId: string; data: OrderProblems; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: ProblemResult | null, fd: FormData): Promise<ProblemResult> => {
    const shrunk = await withShrunkPhotos(fd);
    if (typeof shrunk === "string") return { ok: false, error: shrunk };
    const r = await reportProblem(orderId, prev, shrunk);
    if (r.ok) onDone();
    return r;
  }, null);
  return (
    <form action={action} className={ui.form} style={{ borderTop: "1px solid var(--divider)", paddingTop: 12 }}>
      <label htmlFor="report-category" className={ui.label}>What&apos;s wrong</label>
      <select id="report-category" name="category" className={ui.input} defaultValue="" required>
        <option value="" disabled>Choose…</option>
        {data.categories.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <fieldset className={ui.fieldset}>
        <legend className={ui.legend}>Which items</legend>
        {data.lines.map((l) => (
          <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" name="lines" value={l.id} defaultChecked={data.lines.length === 1} /> Line {l.lineNo} · {l.description}
          </label>
        ))}
      </fieldset>
      {data.shipments.length > 0 && (
        <>
          <label htmlFor="report-shipment" className={ui.label}>Which shipment (optional)</label>
          <select id="report-shipment" name="shipment" className={ui.input} defaultValue={data.shipments.length === 1 ? data.shipments[0]!.id : ""}>
            <option value="">Not sure / none</option>
            {data.shipments.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </>
      )}
      <label htmlFor="report-description" className={ui.label}>What happened</label>
      <textarea id="report-description" name="description" className={ui.input} rows={3} maxLength={2000} />
      <label htmlFor="report-photos" className={ui.label}>Photos (optional, up to {data.maxPhotos})</label>
      <input id="report-photos" name="photos" type="file" accept="image/*" multiple className={ui.input} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Reporting…" : "Report problem"}</button>
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
      {state && !state.ok && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{state.error}</p>}
    </form>
  );
}
