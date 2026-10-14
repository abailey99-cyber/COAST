import { NextResponse } from "next/server";
import { completeTokenLink } from "@/server/auth-links";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = await completeTokenLink(
    url.searchParams.get("token_hash"),
    url.searchParams.get("type"),
    url.searchParams.get("next"),
  );
  return NextResponse.redirect(new URL(path, url.origin));
}
