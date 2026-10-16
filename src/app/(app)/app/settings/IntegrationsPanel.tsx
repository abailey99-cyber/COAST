"use client";

import { useActionState, useState, useTransition } from "react";
import { disconnectIntegration, saveIntegration, type IntegrationResult } from "@/server/credential-actions";
import type { IntegrationItem } from "@/server/integrations";
import styles from "../shell.module.css";

const TONE = { ok: "status-ok", warn: "status-warn", error: "status-bad", unconfigured: "status-neutral" } as const;
const WORD = { ok: "Working", warn: "Check", error: "Needs attention", unconfigured: "Not connected" } as const;

/** Settings → Integrations: each organisation's own connections (readiness Task 2). */
export function IntegrationsPanel({ items, canEdit, storeReady }: { items: IntegrationItem[]; canEdit: boolean; storeReady: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!storeReady && (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          COAST can&apos;t store credentials yet: COAST_CREDENTIAL_KEYS isn&apos;t set in the hosting settings (docs/environments.md).
        </p>
      )}
      {(["Carriers", "Systems"] as const).map((group) => (
        <section key={group} aria-label={group} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 style={{ fontSize: 14 }}>{group}</h3>
          {items
            .filter((i) => i.group === group)
            .map((i) => (
              <Row key={i.provider} item={i} canEdit={canEdit && storeReady} />
            ))}
        </section>
      ))}
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
        Credentials are encrypted before they&apos;re stored and are never shown again — not even to admins. To change one, enter it again.
        {canEdit ? "" : " Only an admin can connect or change these."}
      </p>
    </div>
  );
}

function Row({ item: i, canEdit }: { item: IntegrationItem; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<IntegrationResult | null>(null);
  return (
    <div style={{ border: "1px solid var(--divider)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }} data-provider={i.provider}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <strong>{i.label}</strong>
          <span className={`status ${TONE[i.health.status]}`} style={{ fontSize: 13 }}>● {WORD[i.health.status]} · {i.health.reason}</span>
          {i.detail && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{i.detail}{i.hint ? ` · key ending ${i.hint.replace("…", "")}` : ""}</span>}
        </div>
        {canEdit && !open && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>{i.connected ? "Change" : "Connect"}</button>
            {i.connected && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Disconnect ${i.label}? Its credentials will be deleted from COAST.`)) return;
                  setResult(null);
                  startTransition(async () => setResult(await disconnectIntegration(i.provider)));
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>
      {i.unverified && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Beta: {i.unverified}</span>}
      {result && (result.ok ? <p className={styles.saveStatus} role="status" style={{ margin: 0 }}>✓ {result.message}</p> : <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{result.error}</p>)}
      {open && <ConnectForm item={i} onDone={() => setOpen(false)} />}
    </div>
  );
}

function ConnectForm({ item: i, onDone }: { item: IntegrationItem; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveIntegration.bind(null, i.provider), null as IntegrationResult | null);
  const err = (k: string) => state?.fieldErrors?.[k];
  const id = (k: string) => `int-${i.provider}-${k}`;
  if (state?.ok) {
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <p className={styles.saveStatus} role="status" style={{ margin: 0 }}>✓ {state.message}</p>
        <button type="button" className="btn btn-secondary" onClick={onDone}>Done</button>
      </div>
    );
  }
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--divider)", paddingTop: 10 }} autoComplete="off">
      {i.caution && <p className="notice" style={{ margin: 0 }}>{i.caution}</p>}
      {i.notLiveYet && <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>{i.notLiveYet}</p>}
      {i.configFields.map((f) => (
        <div key={f.key} className="field">
          <label htmlFor={id(f.key)}>{f.label}</label>
          {f.options ? (
            <select id={id(f.key)} name={f.key} className="input" defaultValue={i.config[f.key] ?? f.options[0]}>
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input id={id(f.key)} name={f.key} className="input" defaultValue={i.config[f.key] ?? ""} aria-invalid={Boolean(err(f.key))} />
          )}
          {f.hint && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{f.hint}</span>}
          {err(f.key) && <span className="notice notice-error" style={{ fontSize: 13 }}>{err(f.key)}</span>}
        </div>
      ))}
      {i.secretFields.map((f) => (
        <div key={f.key} className="field">
          <label htmlFor={id(f.key)}>{f.label}{i.connected ? " (leave blank to keep the current one)" : ""}</label>
          {f.multiline ? (
            <textarea id={id(f.key)} name={f.key} className="input" rows={5} spellCheck={false} style={{ height: "auto", padding: 10, fontFamily: "monospace", fontSize: 12 }} aria-invalid={Boolean(err(f.key))} />
          ) : (
            <input id={id(f.key)} name={f.key} type="password" className="input" autoComplete="new-password" spellCheck={false} aria-invalid={Boolean(err(f.key))} />
          )}
          {f.hint && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{f.hint}</span>}
          {err(f.key) && <span className="notice notice-error" style={{ fontSize: 13 }}>{err(f.key)}</span>}
        </div>
      ))}
      {i.consentNeeded && !i.connected && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
          <input type="checkbox" name="consent" style={{ marginTop: 4 }} /> UPS has agreed in writing to us using its API through COAST
        </label>
      )}
      {err("consent") && <span className="notice notice-error" style={{ fontSize: 13 }}>{err("consent")}</span>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : i.connected ? "Save changes" : "Connect"}</button>
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={pending}>Cancel</button>
        {state && !state.ok && <span className="notice notice-error" role="alert">{state.error}</span>}
      </div>
    </form>
  );
}
