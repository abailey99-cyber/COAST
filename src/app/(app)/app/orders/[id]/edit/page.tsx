import { notFound } from "next/navigation";
import { loadOrderEdit } from "@/server/orders";
import { PageHeader } from "../../../PageHeader";
import { EditOrderForm } from "./EditOrderForm";

export const metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await loadOrderEdit(id);
  if (!page) notFound();
  return (
    <>
      <PageHeader title={`Edit ${page.soNumber}`} subtitle="Changes are saved together and recorded in the order's history." />
      <EditOrderForm page={page} />
    </>
  );
}
