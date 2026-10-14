import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPurchaseOrder } from "@/server/procurement";
import { PageHeader } from "../../PageHeader";
import ui from "../../ui.module.css";
import { PoStatusButtons } from "./PoStatusButtons";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await loadPurchaseOrder(id);
  if (!page) notFound();
  const { po } = page;

  return (
    <>
      <PageHeader title={po.poNumber} subtitle={`${po.supplierName} · created ${page.created}`}>
        <Link href="/app/purchase-orders" className="btn btn-secondary">All purchase orders</Link>
      </PageHeader>

      <section className={ui.panel} aria-labelledby="po-summary">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 id="po-summary" style={{ fontSize: 16 }}>Status</h2>
          <span className="status status-neutral">● {page.statusLabel}</span>
        </div>
        <dl className={ui.kv}>
          <dt>Supplier</dt>
          <dd>{po.supplierName}</dd>
          <dt>Supplier email</dt>
          <dd>{po.supplierEmail ?? "Not set"}</dd>
          <dt>Currency</dt>
          <dd>{po.currency}</dd>
          {page.total && (
            <>
              <dt>Total cost</dt>
              <dd>{page.total}</dd>
            </>
          )}
        </dl>
        {page.nextStatuses.length > 0 && <PoStatusButtons poId={po.id} options={page.nextStatuses} />}
        {po.status === "draft" && (
          <p className={ui.muted}>
            {/* UNVERIFIED: no email channel until Phase 2 (and Microsoft 365 in Phase 8). */}
            COAST doesn&apos;t email suppliers yet. Send this PO yourself, then mark it as sent.
          </p>
        )}
      </section>

      <section className={ui.listCard} aria-labelledby="po-lines">
        <h2 id="po-lines" style={{ fontSize: 16, padding: "12px 20px 0" }}>Lines</h2>
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">For order</th>
                <th scope="col">Qty</th>
                {page.canSeeCosts && <th scope="col">Unit cost</th>}
                <th scope="col">Needed by</th>
              </tr>
            </thead>
            <tbody>
              {page.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className={ui.strong}>{l.description}</div>
                    {l.sku && <div className={ui.muted}>{l.sku}</div>}
                  </td>
                  <td>
                    <Link href={`/app/orders/${l.orderId}`}>{l.soNumber}</Link>
                    <div className={ui.muted}>{l.customerName}</div>
                  </td>
                  <td>{l.quantityText}</td>
                  {page.canSeeCosts && <td>{l.unitCost ?? "—"}</td>}
                  <td>{l.requested}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
