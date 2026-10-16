"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const KEY = "coast-cookie-choice";

/**
 * Cookie notice (readiness plan Task 6). COAST uses only cookies it needs:
 * keeping you signed in, and remembering a theme you chose. There are no
 * analytics or advertising cookies; non-essential cookies stay off unless
 * someone opts in — and nothing uses that opt-in yet. The choice is kept in
 * this browser only.
 */
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const chosen = () => {
  // Automated test browsers skip it, so it never covers what they click (tests/e2e/smoke.spec.ts checks it as a normal browser).
  if (navigator.webdriver) return "automated";
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export function CookieNotice() {
  // Hidden on the server and until the browser says no choice has been made.
  const choice = useSyncExternalStore(subscribe, chosen, () => "server");
  if (choice !== null) return null;
  const choose = (value: "essential" | "all") => {
    try {
      window.localStorage.setItem(KEY, value);
    } catch {
      // Private browsing: the notice just comes back next time.
    }
    for (const fn of listeners) fn();
  };
  return (
    <div
      role="region"
      aria-label="Cookies"
      style={{
        position: "fixed",
        insetInline: 16,
        bottom: 16,
        zIndex: 50,
        maxWidth: 560,
        marginInline: "auto",
        background: "var(--surface)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 8px 24px rgba(14, 42, 59, 0.18)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontSize: 14,
      }}
    >
      <p style={{ margin: 0 }}>
        COAST only uses the cookies it needs to work — to keep you signed in and remember your settings. We don&apos;t use analytics or
        advertising cookies. <Link href="/privacy">Privacy notice</Link>
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={() => choose("essential")}>
          Essential only
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => choose("all")}>
          Allow optional cookies
        </button>
      </div>
    </div>
  );
}
