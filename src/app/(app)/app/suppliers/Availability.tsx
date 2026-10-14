"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { importAvailability, removeAvailability, type PredictionResult } from "@/server/prediction-actions";
import ui from "../ui.module.css";

interface Row {
  sku: string;
  days: string;
  source: string;
  updated: string;
}

/**
 * "Available within N days" per product code (decision C2): paste lines in,
 * or choose a CSV file. Used for lead times on lines with that product code,
 * unless someone set the line's lead time by hand.
 */
export function Availability({ rows, total, canEdit }: { rows: Row[]; total: number; canEdit: boolean }) {
  const [state, action, pending] = useActionState(importAvailability, { ok: false } as PredictionResult);
  const [text, setText] = useState("");
  const [source, setSource] = useState<"manual" | "csv">("manual");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section className={ui.panel} aria-labelledby="availability-title">
      <h2 id="availability-title" style={{ fontSize: 16 }}>Availability by product code</h2>
      <p className={ui.muted} style={{ margin: 0 }}>
        How soon each product can be supplied. COAST uses it as the lead time for any line with that product code, unless
        someone has set the line&apos;s lead time by hand. {total} {total === 1 ? "product code" : "product codes"} listed.
      </p>

      {canEdit && (
        <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="hidden" name="source" value={source} />
          <label htmlFor="availability-text" className={ui.label}>Paste one product code and number of working days per line</label>
          <textarea
            id="availability-text"
            name="availability"
            rows={5}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSource("manual");
            }}
            placeholder={"SHF-200, 5\nPRB-90, in stock\nMAT-3, 10"}
            className={ui.input}
            style={{ height: "auto", padding: 10, fontFamily: "inherit" }}
          />
          <span className={ui.hint}>Commas, tabs or semicolons all work; a header row is fine. &quot;In stock&quot; means 0 days. Rows COAST can&apos;t read are listed and left out.</span>
          <div className={ui.actions}>
            <button type="submit" className="btn btn-primary" disabled={pending || !text.trim()}>{pending ? "Saving…" : "Save availability"}</button>
            <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>Choose a CSV file…</button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              aria-label="CSV file of product codes and days"
              onChange={async (e) => {
                setFileError(null);
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 500_000) {
                  setFileError("That file is too big (500 KB at most).");
                  return;
                }
                setText(await file.text());
                setSource("csv");
                e.target.value = "";
              }}
            />
          </div>
          {fileError && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{fileError}</p>}
          {state.error && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{state.error}</p>}
          {state.ok && <p className={ui.muted} role="status" style={{ margin: 0 }}>{state.message}</p>}
          {state.problems && state.problems.length > 0 && (
            <ul className={ui.muted} style={{ margin: 0, paddingLeft: 18 }} aria-label="Rows left out">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </form>
      )}

      {rows.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th scope="col">Product code</th>
                <th scope="col">Available within</th>
                <th scope="col">From</th>
                <th scope="col">Updated</th>
                {canEdit && <th scope="col"><span className="visually-hidden">Remove</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td className={ui.strong}>{r.sku}</td>
                  <td>{r.days}</td>
                  <td>{r.source}</td>
                  <td>{r.updated}</td>
                  {canEdit && (
                    <td>
                      <RemoveButton sku={r.sku} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RemoveButton({ sku }: { sku: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" className={ui.linkButton} disabled={pending} onClick={() => startTransition(async () => void (await removeAvailability(sku)))} aria-label={`Remove ${sku}`}>
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
