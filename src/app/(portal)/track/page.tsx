import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Track an order", robots: { index: false } };

// Customer tracking (Customer.dc.html) is Phase 5, built only on the masked
// order type. Until then this route says so rather than pretending.
export default function TrackPlaceholder() {
  return (
    <main id="main" style={{ maxWidth: "var(--width-customer)", margin: "0 auto", padding: "48px var(--gutter)" }}>
      <h1 style={{ fontSize: 28 }}>Order tracking isn&apos;t open yet</h1>
      <p style={{ marginTop: 12, color: "var(--text-secondary)" }}>
        If you&apos;ve been sent a tracking link, it will work once tracking launches. <Link href="/">Back to COAST</Link>
      </p>
    </main>
  );
}
