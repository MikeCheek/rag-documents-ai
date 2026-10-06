import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { authConfig, createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
}

async function validToken() {
  return createSessionToken(authConfig()!, 3600);
}

describe("middleware", () => {
  afterEach(() => {
    delete process.env.APP_PASSWORD;
    delete process.env.APP_USERNAME;
    delete process.env.APP_SESSION_SECRET;
  });

  it("lets everything through when APP_PASSWORD is unset, and /login goes home", async () => {
    expect((await middleware(request("/api/danger-zone"))).headers.get("x-middleware-next")).toBe("1");
    const res = await middleware(request("/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  describe("with a password", () => {
    it("redirects signed-out page visits to /login, remembering where they were going", async () => {
      process.env.APP_PASSWORD = "s3cret";
      const res = await middleware(request("/chat/abc?x=1"));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/chat/abc?x=1");
      // "/" needs no "next".
      expect(new URL((await middleware(request("/"))).headers.get("location")!).search).toBe("");
    });

    it("answers signed-out API calls with 401 JSON, not a redirect", async () => {
      process.env.APP_PASSWORD = "s3cret";
      const res = await middleware(request("/api/danger-zone"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Not signed in." });
    });

    it("lets the login page and sign-in endpoints through", async () => {
      process.env.APP_PASSWORD = "s3cret";
      for (const path of ["/login", "/api/auth/login", "/api/auth/logout"]) {
        expect((await middleware(request(path))).headers.get("x-middleware-next")).toBe("1");
      }
    });

    it("lets a valid session through, and sends it away from /login", async () => {
      process.env.APP_PASSWORD = "s3cret";
      const token = await validToken();
      expect((await middleware(request("/api/danger-zone", token))).headers.get("x-middleware-next")).toBe("1");
      expect((await middleware(request("/shelf", token))).headers.get("x-middleware-next")).toBe("1");
      expect((await middleware(request("/login", token))).status).toBe(307);
    });

    it("rejects tampered, expired, and outdated sessions", async () => {
      process.env.APP_PASSWORD = "s3cret";
      const token = await validToken();
      const [body, sig] = token.split(".");
      const tampered = `${body.slice(0, -2)}xx.${sig}`;
      expect((await middleware(request("/api/x", tampered))).status).toBe(401);
      expect((await middleware(request("/api/x", "garbage"))).status).toBe(401);

      const expired = await createSessionToken(authConfig()!, 60, Date.now() - 3600_000);
      expect((await middleware(request("/api/x", expired))).status).toBe(401);

      // Changing the password signs out existing sessions.
      process.env.APP_PASSWORD = "new-password";
      expect((await middleware(request("/api/x", token))).status).toBe(401);
    });
  });
});
