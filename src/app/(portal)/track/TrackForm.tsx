"use client";

import { useActionState } from "react";
import { trackOrder, type PortalResult } from "@/server/portal-actions";

export function TrackForm({ buttonClass = "btn btn-primary btn-lg" }: { buttonClass?: string }) {
  const [state, action, pending] = useActionState(trackOrder, { ok: false } as PortalResult);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label htmlFor="track-code">Tracking code</label>
      <input id="track-code" name="code" required placeholder="e.g. K7Q-4M2-XP9" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="input" />
      <button type="submit" className={buttonClass} disabled={pending}>{pending ? "Looking…" : "Track my order"}</button>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
    </form>
  );
}
