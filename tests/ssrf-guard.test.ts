import { describe, expect, it } from "vitest";
import { assertSafeToolUrl, guardedLookup, guardedRequest, isPrivateIp } from "@/lib/agent/ssrf-guard";

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "not-an-ip",
  ])("%s is private", (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "%s is public",
    (ip) => expect(isPrivateIp(ip)).toBe(false)
  );
});

describe("assertSafeToolUrl", () => {
  it.each([
    "http://localhost/x",
    "http://foo.localhost/x",
    "http://127.0.0.1/x",
    "http://[::1]/x",
    "http://[::ffff:7f00:1]/x",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "ftp://example.com/",
    "not a url",
  ])("refuses %s", (url) => expect(() => assertSafeToolUrl(url)).toThrow());

  it("allows a public https URL", () => {
    expect(assertSafeToolUrl("https://api.example.com/v1?q=1").hostname).toBe("api.example.com");
  });
});

describe("guardedLookup", () => {
  it("refuses a hostname that resolves to a private address", async () => {
    // "localhost" resolves to loopback via /etc/hosts, without network access.
    const err = await new Promise<Error | null>((resolve) =>
      guardedLookup("localhost", {}, (e) => resolve(e as Error | null))
    );
    expect(err?.message).toMatch(/private\/internal/);
  });
});

describe("guardedRequest", () => {
  it("refuses private targets before connecting", async () => {
    await expect(guardedRequest("http://127.0.0.1:9/")).rejects.toThrow(/private\/internal/);
  });
});
