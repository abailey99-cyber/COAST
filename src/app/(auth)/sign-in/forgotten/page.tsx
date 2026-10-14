import type { Metadata } from "next";
import { ForgottenForm } from "./ForgottenForm";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgottenPage() {
  return <ForgottenForm />;
}
