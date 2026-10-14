import type { Metadata } from "next";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata: Metadata = { title: "Set your password" };

export default function SetPasswordPage() {
  return <SetPasswordForm />;
}
