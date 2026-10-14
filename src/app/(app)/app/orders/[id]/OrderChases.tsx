"use client";

import { useState, useTransition } from "react";
import { raiseInternalChase, resolveInternalChase, type LoopResult } from "@/server/supplier-actions";
import type { ChaseView } from "@/server/orders";
import ui from "../../ui.module.css";

const LEVEL_CLASS = { none: "status-neutral", amber: "status-warn", red: "status-bad", alert: "status-bad" } as const;

/** Sales (or anyone allowed) asks procurement about a line; procurement answers and closes it. */
export function OrderChases({ chases, lines }: { chases: ChaseView[]; lines: { id: string; label: string }[] }) {
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LoopResult | null>(null);

  return (
    <section className={ui.panel} aria-labelledby="chases-title">
      <h2 id="chases-title" style={{ fontSize: 16 }}>Chases</h2>
      {chases.length === 0 && <p className={ui.muted}>No chases on this order.</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {chases.map((c) => (
          <ChaseItem key={c.id} chase={c} />
        ))}
      </ul>
      {lines.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            startTransition(async () => {
              const r = await raiseInternalChase(lineId, note);
              setResult(r);
              if (r.ok) setNote("");
            });
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--divider)", paddingTop: 12 }}
        >
          <div className={ui.strong} style={{ fontSize: 14 }}>Ask procurement for an update</div>
          <label htmlFor="chase-line" className="visually-hidden">Which line</label>
          <select id="chase-line" value={lineId} onChange={(e) => setLineId(e.target.value)} className={ui.input}>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
          <label htmlFor="chase-note" className="visually-hidden">What do you need to know?</label>
          <textarea id="chase-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What do you need to know?" className={ui.input} style={{ height: "auto", padding: 10 }} />
          <div className={ui.actions}>
            <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Sending…" : "Ask procurement"}</button>
          </div>
          {result && (result.ok ? <p className={ui.muted} role="status">{result.message}</p> : <p className={ui.fieldError} role="alert">{result.error}</p>)}
        </form>
      )}
    </section>
  );
}

function ChaseItem({ chase }: { chase: ChaseView }) {
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li style={{ fontSize: 13 }}>
      <div className={ui.strong}>{chase.lineLabel}</div>
      {chase.note && <div>“{chase.note}”</div>}
      <div className={ui.muted}>
        Asked by {chase.openedBy} · {chase.opened}
      </div>
      {chase.open ? (
        <>
          {chase.waiting && <div className={`status ${LEVEL_CLASS[chase.waiting.level]}`}>● {chase.waiting.label} · waiting {chase.waiting.wait}</div>}
          {chase.canResolve && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                startTransition(async () => {
                  const r = await resolveInternalChase(chase.id, reply);
                  if (!r.ok) setError(r.error ?? "That didn't work.");
                });
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}
            >
              <label htmlFor={`reply-${chase.id}`} className="visually-hidden">Reply</label>
              <input id={`reply-${chase.id}`} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply (optional)" className={ui.input} style={{ flex: "1 1 160px", height: 36 }} />
              <button type="submit" className="btn btn-secondary" disabled={pending} style={{ minHeight: 36 }}>{pending ? "Saving…" : "Answer and close"}</button>
              {error && <span className={ui.fieldError} role="alert">{error}</span>}
            </form>
          )}
        </>
      ) : (
        <div className={ui.muted}>
          <span className="status status-ok">● Answered</span> by {chase.resolvedBy ?? "someone"} · {chase.resolved}
          {chase.reply && <div>“{chase.reply}”</div>}
        </div>
      )}
    </li>
  );
}
