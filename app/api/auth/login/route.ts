import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  createSessionToken,
  safeEqual,
  SESSION_COOKIE,
  SESSION_DAYS_REMEMBERED,
  SESSION_HOURS_DEFAULT,
} from "@/lib/auth/session";
import { clearFailures, recordFailure, retryAfterMs } from "@/lib/auth/login-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || req.ip || "local";
}

/** Secure cookies over HTTPS (directly, or behind a proxy that says so). */
function isHttps(req: NextRequest): boolean {
  return req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

export async function POST(req: NextRequest) {
  const auth = authConfig();
  if (!auth) return NextResponse.json({ error: "Sign-in isn't enabled (APP_PASSWORD is not set)." }, { status: 400 });

  const key = clientKey(req);
  const wait = retryAfterMs(key);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const remember = body?.remember === true;

  // Both compared every time, in constant time, so neither timing nor the
  // message reveals which one was wrong.
  const userOk = safeEqual(username, auth.username);
  const passOk = safeEqual(password, auth.password);
  if (!userOk || !passOk) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }

  clearFailures(key);
  const maxAge = remember ? SESSION_DAYS_REMEMBERED * 24 * 3600 : SESSION_HOURS_DEFAULT * 3600;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(auth, maxAge), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    // Without "keep me signed in" it's a browser-session cookie (gone when
    // the browser closes); the token itself expires either way.
    ...(remember ? { maxAge } : {}),
  });
  return res;
}
