import type { Metadata } from "next";
import styles from "../marketing.module.css";

export const metadata: Metadata = { title: "Sub-processors", description: "The services COAST uses to process personal data." };

// PLACEHOLDER (readiness plan Task 6): the founder confirms this list with each provider's terms.
const SUB_PROCESSORS = [
  { name: "Supabase", purpose: "Database, sign-in and file storage", location: "EU (Ireland)" },
  { name: "Vercel", purpose: "Hosting the COAST app", location: "EU (Dublin) for processing; global network for delivering pages" },
  { name: "Mailgun", purpose: "Receiving supplier replies forwarded to COAST", location: "EU" },
  { name: "Microsoft", purpose: "Reading and sending email — only for businesses that connect their own Microsoft 365 mailbox", location: "The business's own Microsoft 365 region" },
  { name: "Tracking aggregator (to be confirmed)", purpose: "Checking where parcels are with carriers", location: "To be confirmed" },
];

export default function SubProcessorsPage() {
  return (
    <section className={styles.section} style={{ maxWidth: 900 }} aria-labelledby="sub-title">
      <p className="notice" role="note" style={{ margin: 0 }}>Draft placeholder: this list is being confirmed and may change before COAST is generally available.</p>
      <h1 id="sub-title" className={styles.pageTitle} style={{ color: "var(--text-strong)" }}>Sub-processors</h1>
      <p className={styles.sectionLead}>The services COAST uses that may process personal data on behalf of the businesses using COAST.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              {["Service", "What for", "Where"].map((h) => (
                <th key={h} scope="col" style={{ textAlign: "left", padding: "8px 12px 8px 0", borderBottom: "1px solid var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUB_PROCESSORS.map((s) => (
              <tr key={s.name}>
                <td style={{ padding: "8px 12px 8px 0", borderBottom: "1px solid var(--divider)", fontWeight: 600 }}>{s.name}</td>
                <td style={{ padding: "8px 12px 8px 0", borderBottom: "1px solid var(--divider)" }}>{s.purpose}</td>
                <td style={{ padding: "8px 0", borderBottom: "1px solid var(--divider)" }}>{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
