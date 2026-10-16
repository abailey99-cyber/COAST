"use client";

import { useActionState, useState, useTransition } from "react";
import { signOut } from "@/server/auth-actions";
import { confirmMfaSetup, startMfaSetup, verifyMfaCode, type MfaResult } from "@/server/mfa-actions";
import styles from "../../auth.module.css";

function CodeField({ id }: { id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>6-digit code from your app</label>
      <input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="input" placeholder="123 456" />
    </div>
  );
}

export function TwoStepForms({ setup }: { setup: boolean }) {
  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.title}>{setup ? "Set up two-step sign-in" : "Two-step sign-in"}</h1>
        <p className={styles.lede}>
          {setup
            ? "Your company keeps COAST safe with an authenticator app as well as your password. It takes a minute, once."
            : "Enter the code from your authenticator app to finish signing in."}
        </p>
      </div>
      {setup ? <Setup /> : <Verify />}
      <form action={signOut} className={styles.foot}>
        <button type="submit" className="btn btn-secondary">Sign out</button>
      </form>
    </>
  );
}

function Verify() {
  const [state, action, pending] = useActionState(verifyMfaCode, null as MfaResult | null);
  return (
    <form action={action} className={styles.form}>
      {state?.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      <CodeField id="mfa-code" />
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={pending}>{pending ? "Checking…" : "Continue"}</button>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Lost your phone? Ask an admin of your company to reset your two-step sign-in.</p>
    </form>
  );
}

function Setup() {
  const [pending, startTransition] = useTransition();
  const [factor, setFactor] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!factor) {
    return (
      <div className={styles.form}>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>
          <li>Install an authenticator app on your phone, such as Microsoft Authenticator or Google Authenticator.</li>
          <li>Show your QR code below and scan it with the app.</li>
          <li>Type in the 6-digit code the app shows.</li>
        </ol>
        <button
          type="button"
          className="btn btn-primary btn-block btn-lg"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await startMfaSetup();
              if (r.ok) setFactor(r);
              else setError(r.error);
            })
          }
        >
          {pending ? "Preparing…" : "Show my QR code"}
        </button>
      </div>
    );
  }
  return <ConfirmSetup {...factor} />;
}

function ConfirmSetup({ factorId, qr, secret }: { factorId: string; qr: string; secret: string }) {
  const [state, action, pending] = useActionState(confirmMfaSetup.bind(null, factorId), null as MfaResult | null);
  return (
    <form action={action} className={styles.form}>
      {state?.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL from Supabase, shown once */}
      <img src={qr} alt="QR code to scan with your authenticator app" width={180} height={180} style={{ alignSelf: "center", background: "#ffffff", padding: 8, borderRadius: 8 }} />
      <p style={{ margin: 0, fontSize: 13 }}>
        Can&apos;t scan it? Enter this key in the app instead:{" "}
        <code data-testid="mfa-secret" style={{ wordBreak: "break-all" }}>{secret}</code>
      </p>
      <CodeField id="mfa-setup-code" />
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={pending}>{pending ? "Checking…" : "Turn on two-step sign-in"}</button>
    </form>
  );
}
