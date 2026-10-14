"use client";

import { useState, useTransition } from "react";
import { chaseSupplier, makeNewLink, revokePoLink, sendPoToSupplier, type LoopResult } from "@/server/supplier-actions";
import ui from "../../ui.module.css";

/** A result that may include a link to show once, with a copy button. */
export function LoopNotice({ result }: { result: LoopResult | null }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  if (!result.ok) return <p className="notice notice-error" role="alert">{result.error}</p>;
  return (
    <div className="notice" role="status">
      {result.message && <p>{result.message}</p>}
      {result.link && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>{result.link}</code>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(result.link!);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

export function SupplierActions({ poId, status, hasEmail }: { poId: string; status: string; hasEmail: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LoopResult | null>(null);
  const run = (fn: () => Promise<LoopResult>) => {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  };
  const open = status === "draft" || status === "sent";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className={ui.actions}>
        {open && (
          <button type="button" className="btn btn-primary" disabled={pending || !hasEmail} onClick={() => run(() => sendPoToSupplier(poId))}>
            {status === "draft" ? "Send to supplier" : "Send again"}
          </button>
        )}
        {status === "sent" && (
          <button type="button" className="btn btn-secondary" disabled={pending || !hasEmail} onClick={() => run(() => chaseSupplier(poId))}>
            Chase supplier
          </button>
        )}
        {open && (
          <button type="button" className={ui.linkButton} disabled={pending} onClick={() => run(() => makeNewLink(poId))}>
            Make a new confirmation link
          </button>
        )}
        {pending && <span className={ui.muted} role="status">Working…</span>}
      </div>
      {!hasEmail && open && <p className={ui.muted}>This supplier has no email address, so COAST can&apos;t write the email. Make a link and send it yourself, or add their email on the Suppliers screen.</p>}
      <LoopNotice result={result} />
    </div>
  );
}

export function RevokeLinkButton({ poId, linkId }: { poId: string; linkId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LoopResult | null>(null);
  return (
    <>
      <button
        type="button"
        className={ui.linkButton}
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Revoke this link? The supplier won't be able to use it any more.")) return;
          startTransition(async () => setResult(await revokePoLink(poId, linkId)));
        }}
      >
        Revoke
      </button>
      {result && !result.ok && <span className={ui.fieldError} role="alert"> {result.error}</span>}
    </>
  );
}
