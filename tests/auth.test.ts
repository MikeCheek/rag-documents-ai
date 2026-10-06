import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  authConfig,
  createSessionToken,
  safeEqual,
  safeNextPath,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth/session";
import { clearFailures, MAX_FAILURES, recordFailure, retryAfterMs, WINDOW_MS } from "@/lib/auth/login-limiter";

describe("sessions", () => {
  const config = { username: "mike", password: "pässwörd" };

  it("round-trips, and expires", async () => {
    const token = await createSessionToken(config, 60);
    expect(await verifySessionToken(config, token)).toMatchObject({ u: "mike" });
    expect(await verifySessionToken(config, token, Date.now() + 61_000)).toBeNull();
  });

  it("is tied to the username, password, or explicit secret", async () => {
    const token = await createSessionToken(config, 60);
    expect(await verifySessionToken({ ...config, password: "other" }, token)).toBeNull();
    expect(await verifySessionToken({ ...config, username: "other" }, token)).toBeNull();
    const withSecret = { ...config, secret: "abc" };
    const t2 = await createSessionToken(withSecret, 60);
    expect(await verifySessionToken(withSecret, t2)).not.toBeNull();
    // With a secret, a password change doesn't invalidate sessions.
    expect(await verifySessionToken({ ...withSecret, password: "changed" }, t2)).not.toBeNull();
  });

  it("rejects malformed tokens", async () => {
    for (const t of [undefined, "", "a", "a.b.c", "!!!.!!!"]) expect(await verifySessionToken(config, t)).toBeNull();
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/chat/abc?x=1", "/chat/abc?x=1"],
    ["/shelf", "/shelf"],
    [null, "/"],
    ["https://evil.com", "/"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/login?next=/x", "/"],
    ["/api/danger-zone", "/"],
    ["/x\n", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNextPath(input as any)).toBe(expected);
  });
});

describe("safeEqual", () => {
  it("compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("login limiter", () => {
  // Without a database this exercises the in-memory fallback; the
  // Postgres path is covered in tests/login-limiter.integration.test.ts.
  beforeAll(() => {
    delete process.env.DATABASE_URL;
  });
  it("blocks after too many failures, until the window passes", async () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_FAILURES - 1; i++) await recordFailure("ip1", now);
    expect(await retryAfterMs("ip1", now)).toBe(0);
    await recordFailure("ip1", now);
    expect(await retryAfterMs("ip1", now)).toBe(WINDOW_MS);
    expect(await retryAfterMs("ip1", now + WINDOW_MS)).toBe(0);
    expect(await retryAfterMs("ip2", now)).toBe(0);
    await recordFailure("ip3", now);
    await clearFailures("ip3");
    expect(await retryAfterMs("ip3", now)).toBe(0);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    process.env.APP_PASSWORD = "s3cret";
    process.env.APP_USERNAME = "mike";
  });
  afterEach(() => {
    delete process.env.APP_PASSWORD;
    delete process.env.APP_USERNAME;
  });

  const login = async (body: object, ip = "10.0.0.1", proto = "http") => {
    const { POST } = await import("@/app/api/auth/login/route");
    return POST(
      new NextRequest(`${proto}://localhost/api/auth/login`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "x-forwarded-for": ip },
      })
    );
  };

  it("signs in with the right credentials: HttpOnly session cookie that verifies", async () => {
    const res = await login({ username: "mike", password: "s3cret" });
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.maxAge).toBeUndefined(); // browser-session cookie without "remember"
    expect(await verifySessionToken(authConfig()!, cookie.value)).toMatchObject({ u: "mike" });
  });

  it("keeps the session for 30 days when asked, Secure over HTTPS", async () => {
    const res = await login({ username: "mike", password: "s3cret", remember: true }, "10.0.0.2", "https");
    const cookie = res.cookies.get(SESSION_COOKIE)!;
    expect(cookie.maxAge).toBe(30 * 24 * 3600);
    expect(cookie.secure).toBe(true);
  });

  it("refuses wrong credentials with the same message either way", async () => {
    const a = await login({ username: "mike", password: "nope" }, "10.0.0.3");
    const b = await login({ username: "nope", password: "s3cret" }, "10.0.0.3");
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    expect(a.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("locks a client out after too many failures, even with the right password", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await login({ username: "mike", password: "x" }, "10.0.0.9");
    const res = await login({ username: "mike", password: "s3cret" }, "10.0.0.9");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    // Other clients are unaffected.
    expect((await login({ username: "mike", password: "s3cret" }, "10.0.0.10")).status).toBe(200);
  }, 20_000);
});
