"use client";

import { useActionState } from "react";
import { registerInterest, type LeadResult } from "@/server/lead-actions";

export function InterestForm({ refCode, business }: { refCode: string; business: string }) {
  const [state, action, pending] = useActionState(registerInterest, { ok: false } as LeadResult);
  if (state.ok) {
    return (
      <p className="notice" role="status">
        Thanks — we&apos;ve got your details and we&apos;ll be in touch soon.
      </p>
    );
  }
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="ref" value={refCode} />
      <input type="hidden" name="b" value={business} />
      <div className="field">
        <label htmlFor="li-name">Your name</label>
        <input id="li-name" name="name" required maxLength={120} autoComplete="name" className="input" />
      </div>
      <div className="field">
        <label htmlFor="li-company">Company</label>
        <input id="li-company" name="company" required maxLength={200} autoComplete="organization" className="input" />
      </div>
      <div className="field">
        <label htmlFor="li-email">Work email</label>
        <input id="li-email" name="email" type="email" required autoComplete="email" className="input" />
      </div>
      <div className="field">
        <label htmlFor="li-phone">Phone (optional)</label>
        <input id="li-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" className="input" />
      </div>
      <div className="field">
        <label htmlFor="li-size">How many people work there?</label>
        <select id="li-size" name="size" className="input" defaultValue="">
          <option value="">Choose…</option>
          <option value="1-10">1–10</option>
          <option value="11-50">11–50</option>
          <option value="51-200">51–200</option>
          <option value="201+">More than 200</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="li-message">Anything you&apos;d like us to know? (optional)</label>
        <textarea id="li-message" name="message" rows={3} maxLength={2000} className="input" style={{ height: "auto", padding: 10 }} />
      </div>
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="li-website">Website</label>
        <input id="li-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Sending…" : "Register interest"}</button>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
    </form>
  );
}
