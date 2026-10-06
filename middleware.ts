import { NextRequest, NextResponse } from "next/server";

// Optional password protection for the whole app — pages and API routes
// alike. Without it, anyone who can reach the server can read every
// document, spend the OpenRouter quota, register custom tools, and use the
// Danger Zone. Set APP_PASSWORD (and optionally APP_USERNAME) in
// .env.local to require HTTP Basic auth; the browser prompts once and then
// sends the credentials with every request, including the app's own
// fetch() calls, so nothing else needs to change.
//
// Basic auth sends the password with every request, so use it over HTTPS
// anywhere other than localhost.

export const config = {
  // Everything except Next's own static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

let warned = false;

/** Constant-time comparison, so response timing doesn't leak the password. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (!warned && process.env.NODE_ENV === "production") {
      warned = true;
      console.warn(
        "APP_PASSWORD is not set: the app and its API (including the Danger Zone) are open to anyone who can reach this server."
      );
    }
    return NextResponse.next();
  }

  const username = process.env.APP_USERNAME || "admin";
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      // atob gives one char per byte; decode those bytes as UTF-8 so
      // non-ASCII passwords compare correctly.
      const binary = atob(header.slice("Basic ".length));
      const decoded = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
      const sep = decoded.indexOf(":");
      if (
        sep !== -1 &&
        safeEqual(decoded.slice(0, sep), username) &&
        safeEqual(decoded.slice(sep + 1), password)
      ) {
        return NextResponse.next();
      }
    } catch {
      // Malformed base64 — fall through to the challenge.
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Reading Room", charset="UTF-8"' },
  });
}
