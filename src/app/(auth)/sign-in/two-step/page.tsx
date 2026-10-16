import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/server/session";
import { TwoStepForms } from "./TwoStepForms";

export const metadata: Metadata = { title: "Two-step sign-in" };

/** The second step for staff: set up an authenticator app, or enter its code (readiness Task 5B). */
export default async function TwoStepPage() {
  const session = await getStaffSession();
  if (session.state === "staff") redirect("/app/home");
  if (session.state !== "needs-mfa") redirect("/sign-in");
  return <TwoStepForms setup={!session.enrolled} />;
}
