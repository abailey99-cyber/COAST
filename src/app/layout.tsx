import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import "../../design/tokens.css";
import "@/styles/globals.css";
import { CookieNotice } from "@/components/CookieNotice";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "COAST — Know where every order is, before your customer asks",
    template: "%s · COAST",
  },
  description: "COAST follows each order from purchase order to doorstep.",
  applicationName: "COAST",
};

export const viewport: Viewport = {
  themeColor: "#0E2A3B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" data-theme="light" className={sora.variable}>
      <body>
        {children}
        <CookieNotice />
      </body>
    </html>
  );
}
