import { loadSuppliers } from "@/server/procurement";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";
import { AddSupplierForm } from "./AddSupplierForm";
import { Availability } from "./Availability";
import { KnownSenders } from "./KnownSenders";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const { canSee, canCreate, suppliers, availability } = await loadSuppliers();

  if (!canSee) {
    return (
      <>
        <PageHeader title="Suppliers" />
        <section className={ui.panel}>
          <p className={ui.muted}>Your company has chosen not to show supplier names to your role. Ask an admin if you need them.</p>
        </section>
        <Availability {...availability} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Suppliers" subtitle={`${suppliers.length} ${suppliers.length === 1 ? "supplier" : "suppliers"}`} />
      <section className={ui.listCard} aria-label="Suppliers">
        {suppliers.length === 0 ? (
          <p className={ui.empty}>No suppliers yet.{canCreate ? " Add the first one below." : ""}</p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Typical lead time</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className={ui.strong}>{s.name}</td>
                    <td>
                      {s.email ?? "—"}
                      <KnownSenders supplierId={s.id} name={s.name} senders={s.knownSenders} canEdit={canCreate} />
                    </td>
                    <td>{s.phone ?? "—"}</td>
                    <td>{s.currency}</td>
                    <td>{s.leadTimeDays === null ? <span className={ui.muted}>Not known</span> : `${s.leadTimeDays} working days`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canCreate && <AddSupplierForm />}
      <Availability {...availability} />
    </>
  );
}
