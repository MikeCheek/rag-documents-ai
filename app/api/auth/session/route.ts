import { NextRequest, NextResponse } from "next/server";
import { authConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether sign-in is enabled and who is signed in (for the top bar). */
export async function GET(req: NextRequest) {
  const auth = authConfig();
  if (!auth) return NextResponse.json({ enabled: false, username: null });
  const session = await verifySessionToken(auth, req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json({ enabled: true, username: session?.u ?? null });
}
