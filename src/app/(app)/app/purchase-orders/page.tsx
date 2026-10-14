import Link from "next/link";
import { loadPurchaseOrders } from "@/server/procurement";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";

export const metadata = { title: "Purchase orders" };

export default async function PurchaseOrdersPage() {
  const { canSee, pos } = await loadPurchaseOrders();

  return (
    <>
      <PageHeader title="Purchase orders" subtitle="Raised from an order's lines. Sending them by email arrives in Phase 2." />
      <section className={ui.listCard} aria-label="Purchase orders">
        {!canSee ? (
          <p className={ui.empty}>Your company has chosen not to show supplier details to your role. Ask an admin if you need them.</p>
        ) : pos.length === 0 ? (
          <p className={ui.empty}>No purchase orders yet. Open an order with a line that needs one to raise it.</p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">PO</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">For order</th>
                  <th scope="col">Lines</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/app/purchase-orders/${p.id}`} className={ui.rowLink}>{p.poNumber}</Link></td>
                    <td>{p.supplierName}</td>
                    <td>
                      {p.orders.map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && ", "}
                          <Link href={`/app/orders/${o.id}`}>{o.soNumber}</Link>
                        </span>
                      ))}
                    </td>
                    <td>{p.lineCount}</td>
                    <td>{p.created}</td>
                    <td><span className="status status-neutral">● {p.statusLabel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
