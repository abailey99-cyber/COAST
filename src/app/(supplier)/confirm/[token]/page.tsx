import type { Metadata } from "next";
import { loadConfirmPage } from "@/server/confirm-page";
import { ConfirmForm } from "./ConfirmForm";
import styles from "./confirm.module.css";

// The link code is in the address: never index it, never leak it as a referrer.
export const metadata: Metadata = { title: "Confirm purchase order", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { title: string; body: string }> = {
  invalid: { title: "This link doesn't work", body: "Check you've copied the whole link from the email. If it still doesn't work, reply to the purchase order email instead." },
  expired: { title: "This link has expired", body: "Please reply to the purchase order email with your confirmed delivery date, or ask for a new link." },
  revoked: { title: "This link has been replaced", body: "A newer link was sent. Please use the most recent email, or reply to it with your confirmed delivery date." },
  closed: { title: "This purchase order has been cancelled", body: "There's nothing to confirm. If you think this is a mistake, reply to the purchase order email." },
  unavailable: { title: "Confirmation isn't available right now", body: "Please reply to the purchase order email with your confirmed delivery date." },
};

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await loadConfirmPage(token);
  const v = page.view;

  return (
    <div className={styles.page} data-theme="light">
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.buyer}>{v?.buyerName ?? "Purchase order"}</span>
          <span className={styles.powered}>Confirmation by COAST</span>
        </div>
      </header>
      <main id="main" className={styles.main}>
        {page.state !== "open" || !v ? (
          <section className={styles.card}>
            <h1 className={styles.title}>{MESSAGES[page.state]?.title ?? MESSAGES.invalid!.title}</h1>
            <p className={styles.lede}>{MESSAGES[page.state]?.body ?? MESSAGES.invalid!.body}</p>
          </section>
        ) : (
          <>
            <section className={styles.card}>
              <p className={styles.eyebrow}>Purchase order</p>
              <h1 className={styles.title}>{v.poNumber}</h1>
              <p className={styles.lede}>
                From {v.buyerName} to {v.supplierName}. Please confirm what you can supply and when. No login needed.
              </p>
              {v.confirmed && <p className="notice" role="status">This order is already confirmed. You can still send an update below if anything changes.</p>}
              {!v.confirmed && v.lastAnswer && <p className="notice" role="status">Thanks — we received your answer on {v.lastAnswer}. You can send an update below.</p>}
            </section>
            <ConfirmForm token={token} lines={v.lines} currency={v.currency} />
            <p className={styles.footnote}>This link works until {v.expires}. Prices are in {v.currency}.</p>
          </>
        )}
      </main>
    </div>
  );
}
