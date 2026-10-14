import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/server/session";
import { SignInPanel } from "./SignInPanel";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "not-staff": "This account isn't set up as a COAST team member. Ask your COAST admin.",
  link: "That link has expired or has already been used. Ask for a new one below.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "";
  const errorKey = typeof params.error === "string" ? params.error : "";

  const session = await getStaffSession();
  if (session.state === "staff") redirect("/app");

  return (
    <SignInPanel
      next={next}
      initialError={ERRORS[errorKey]}
      notConnected={session.state === "unconfigured"}
    />
  );
}
