import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/logic/permissions";
import { loadNewOrderForm } from "@/server/orders";
import { requireStaff } from "@/server/session";
import { PageHeader } from "../../PageHeader";
import { NewOrderForm } from "./NewOrderForm";

export const metadata = { title: "New order" };

export default async function NewOrderPage() {
  const staff = await requireStaff({ section: "orders" });
  if (!hasPermission(staff.permissions, "orders.edit")) redirect("/app/orders");
  const { reps, defaultRepId } = await loadNewOrderForm();
  return (
    <>
      <PageHeader title="New order" subtitle="Enter an order by hand. Orders from NetSuite will arrive automatically once it's connected." />
      <NewOrderForm reps={reps} defaultRepId={defaultRepId} mustBeOwnRep={!hasPermission(staff.permissions, "orders.view_all")} />
    </>
  );
}
