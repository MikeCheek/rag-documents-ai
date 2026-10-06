import { NextRequest, NextResponse } from "next/server";
import { authConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Optional password protection for the whole app — pages and API routes
// alike. Without it, anyone who can reach the server can read every
// document, spend the OpenRouter quota, register tools, and use the Danger
// Zone. Set APP_PASSWORD (and optionally APP_USERNAME) in .env.local to
// require signing in at /login; a signed session cookie then authorizes
// every request (lib/auth/session.ts).
//
// Signed out: pages redirect to /login (remembering where you were going),
// API requests get a 401 JSON error. Use HTTPS anywhere other than
// localhost, so the password and cookie aren't sent in the clear.

export const config = {
  // Everything except Next's own static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

/** Reachable without a session: the login page and the sign-in/out endpoints. */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

let warned = false;

export async function middleware(req: NextRequest) {
  const auth = authConfig();
  if (!auth) {
    if (!warned && process.env.NODE_ENV === "production") {
      warned = true;
      console.warn(
        "APP_PASSWORD is not set: the app and its API (including the Danger Zone) are open to anyone who can reach this server."
      );
    }
    // Nothing to sign in to.
    if (req.nextUrl.pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  const { pathname, search } = req.nextUrl;
  const session = await verifySessionToken(auth, req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_PATHS.has(pathname)) {
    // Already signed in: the login page has nothing to offer.
    if (session && pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}
