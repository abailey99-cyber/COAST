import Link from "next/link";
import { loadReviewQueue } from "@/server/supplier-loop";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";
import { ReviewForm } from "./ReviewForm";
import { EmailsToSort } from "./EmailsToSort";
import { loadEmailsToSort } from "@/server/inbound-view";

export const metadata = { title: "Review queue" };

export default async function ReviewQueuePage() {
  const [{ canReview, items }, emails] = await Promise.all([loadReviewQueue(), loadEmailsToSort()]);

  return (
    <>
      <PageHeader
        title="Review queue"
        subtitle={items.length ? `${items.length} supplier ${items.length === 1 ? "answer needs" : "answers need"} a person to check` : "Supplier answers COAST wasn't sure about"}
      />
      {emails.canSort && emails.items.length > 0 && <EmailsToSort items={emails.items} />}
      {items.length === 0 ? (
        <section className={ui.panel}>
          <p className={ui.muted}>Nothing to review. Answers that are certain and match the PO are applied automatically.</p>
        </section>
      ) : (
        items.map((item) => (
          <section key={item.id} className={ui.panel} aria-labelledby={`r-${item.id}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 id={`r-${item.id}`} style={{ fontSize: 16 }}>
                <Link href={`/app/purchase-orders/${item.poId}`}>{item.poNumber}</Link> · {item.supplierName}
              </h2>
              <span className={ui.muted}>
                {item.source}
                {item.confidence ? ` · ${item.confidence}` : ""} · {item.when}
              </span>
            </div>
            <div>
              <div className={ui.strong} style={{ fontSize: 14 }}>Why it&apos;s here</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 14 }}>
                {item.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            {item.tracking.length > 0 && <p className={ui.muted}>Tracking numbers found: {item.tracking.join(", ")} — added as shipments when you accept</p>}
            {item.note && <p className={ui.muted}>Supplier&apos;s note: “{item.note}”</p>}
            {item.rawText && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>{item.source === "Email" ? "The email" : "The email as pasted"}</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: "8px 0 0" }}>{item.rawText}</pre>
              </details>
            )}
            {canReview ? <ReviewForm item={item} /> : <p className={ui.muted}>Only procurement can accept or reject answers.</p>}
          </section>
        ))
      )}
    </>
  );
}
