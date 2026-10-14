"use client";

import { TrackForm } from "@/app/(portal)/track/TrackForm";
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { signInStaff, type FormState } from "@/server/auth-actions";
import styles from "../auth.module.css";

type Tab = "team" | "track";

export function SignInPanel({ next, initialError, notConnected }: { next: string; initialError?: string; notConnected: boolean }) {
  const [tab, setTab] = useState<Tab>("team");
  const [state, action, pending] = useActionState<FormState, FormData>(signInStaff, { error: initialError });
  const id = useId();
  const teamTab = `${id}-team-tab`;
  const trackTab = `${id}-track-tab`;
  const teamPanel = `${id}-team`;
  const trackPanel = `${id}-track`;

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const nextTab = tab === "team" ? "track" : "team";
      setTab(nextTab);
      document.getElementById(nextTab === "team" ? teamTab : trackTab)?.focus();
    }
  }

  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.title}>Welcome to COAST</h1>
        <p className={styles.lede}>Choose how you&apos;d like to sign in.</p>
      </div>

      <div role="tablist" aria-label="Account type" className={styles.tabs} onKeyDown={onTabKey}>
        <button
          id={teamTab}
          type="button"
          role="tab"
          aria-selected={tab === "team"}
          aria-controls={teamPanel}
          tabIndex={tab === "team" ? 0 : -1}
          className={styles.tab}
          onClick={() => setTab("team")}
        >
          My team
        </button>
        <button
          id={trackTab}
          type="button"
          role="tab"
          aria-selected={tab === "track"}
          aria-controls={trackPanel}
          tabIndex={tab === "track" ? 0 : -1}
          className={styles.tab}
          onClick={() => setTab("track")}
        >
          Track an order
        </button>
      </div>

      <div id={teamPanel} role="tabpanel" aria-labelledby={teamTab} hidden={tab !== "team"}>
        <form action={action} className={styles.form}>
          <p className={styles.help}>For staff using COAST: purchasing, sales, logistics and admin.</p>
          {notConnected && (
            <p className="notice" role="status">
              Sign-in isn&apos;t connected yet. Your administrator needs to finish setting COAST up.
            </p>
          )}
          {state.error && (
            <p className="notice notice-error" role="alert">
              {state.error}
            </p>
          )}
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label htmlFor={`${id}-email`}>Work email</label>
            <input id={`${id}-email`} name="email" type="email" autoComplete="username" required placeholder="you@company.co.uk" className="input" />
          </div>
          <div className="field">
            <div className={styles.labelRow}>
              <label htmlFor={`${id}-password`}>Password</label>
              <Link href="/sign-in/forgotten" className={styles.smallLink}>Forgotten it?</Link>
            </div>
            <input id={`${id}-password`} name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={pending || notConnected}>
            {pending ? "Signing in…" : "Sign in to the app"}
          </button>
        </form>
      </div>

      <div id={trackPanel} role="tabpanel" aria-labelledby={trackTab} hidden={tab !== "track"}>
        <div className={styles.form}>
          <p className={styles.help}>Ordered from a business that uses COAST? Check your delivery here. No account needed.</p>
          {/* Decision E4: the tracking code alone is enough (no postcode box). */}
          <TrackForm buttonClass="btn btn-primary btn-block btn-lg" />
          <p className={styles.help} style={{ textAlign: "center" }}>or</p>
          <Link href="/portal/sign-in" className="btn btn-secondary btn-block">Sign in to your customer account</Link>
        </div>
      </div>
    </>
  );
}
