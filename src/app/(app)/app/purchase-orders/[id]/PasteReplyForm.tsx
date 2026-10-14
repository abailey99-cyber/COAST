"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { pasteSupplierReply, type LoopResult } from "@/server/supplier-actions";
import ui from "../../ui.module.css";
import { LoopNotice } from "./SupplierActions";

/** Paste a supplier's email; COAST reads it with rules, and applies it or queues it for review. */
export function PasteReplyForm({ poId }: { poId: string }) {
  const [state, action, pending] = useActionState<LoopResult, FormData>(pasteSupplierReply.bind(null, poId), { ok: true });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.message) form.current?.reset();
  }, [state]);

  return (
    <form
      ref={form}
      className={ui.fieldset}
      aria-labelledby="paste-title"
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <h2 id="paste-title" style={{ fontSize: 16 }}>Paste the supplier&apos;s reply</h2>
      <p className={ui.muted}>
        Copy the whole email, including the subject, and paste it here. COAST reads dates, PO numbers and tracking numbers. If
        it&apos;s sure and everything matches, it&apos;s applied; otherwise it goes to the review queue for you to check.
      </p>
      <label htmlFor="paste-email" className="visually-hidden">Supplier&apos;s email</label>
      <textarea id="paste-email" name="email" rows={7} className={ui.input} style={{ height: "auto", padding: 12 }} placeholder="Subject: RE: Purchase order PO-5001…" />
      <div className={ui.actions}>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Reading…" : "Read this email"}</button>
      </div>
      {(state.message || !state.ok) && <LoopNotice result={state} />}
    </form>
  );
}
