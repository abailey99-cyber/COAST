import { NextResponse } from "next/server";
import { completeCodeLink } from "@/server/auth-links";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = await completeCodeLink(url.searchParams.get("code"), url.searchParams.get("next"));
  return NextResponse.redirect(new URL(path, url.origin));
}
