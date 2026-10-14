"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/logic/theme";

export async function setAppTheme(value: string): Promise<void> {
  const theme = parseTheme(value);
  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE, theme, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}
