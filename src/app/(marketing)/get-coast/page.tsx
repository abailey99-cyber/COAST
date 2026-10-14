import type { Metadata } from "next";
import styles from "../marketing.module.css";
import { InterestForm } from "./InterestForm";

export const metadata: Metadata = { title: "Get COAST for your business" };

type Search = Record<string, string | string[] | undefined>;

/** Register interest (spec §5.8). Copy follows the handoff's approved wording where it exists (§7.4). */
export default async function GetCoastPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref.slice(0, 20) : "";
  const b = typeof sp.b === "string" ? sp.b.slice(0, 63) : "";

  return (
    <>
      <section className={`${styles.hero} band-dark`} aria-labelledby="gc-title">
        <div className={styles.heroInner}>
          <p className="eyebrow">Centralised Order And Shipment Tracking</p>
          <h1 id="gc-title" className={styles.heroTitle}>Know where every order is, before your customer asks.</h1>
          <p className={styles.heroBody}>
            {ref === "track" || ref === "portal"
              ? "The tracking page you just saw is COAST. Give your own customers the same: an honest delivery date, without them ever seeing who your suppliers are."
              : "COAST follows each order from purchase order to doorstep. It chases suppliers for you, tracks every carrier in one place, and gives your customers an honest delivery date, even before anything has shipped."}
          </p>
        </div>
      </section>
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "40px var(--gutter) 64px", display: "flex", flexDirection: "column", gap: 16 }} aria-labelledby="form-title">
        <h2 id="form-title" style={{ fontSize: 24 }}>Register interest</h2>
        <p style={{ color: "var(--text-secondary)" }}>
          Tell us a little about your business and we&apos;ll be in touch. No obligation, and we won&apos;t share your details.
        </p>
        <InterestForm refCode={ref} business={b} />
      </section>
    </>
  );
}
