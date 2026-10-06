import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const basic = (user: string, pass: string) =>
  "Basic " + Buffer.from(`${user}:${pass}`, "utf-8").toString("base64");

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/danger-zone", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("middleware", () => {
  afterEach(() => {
    delete process.env.APP_PASSWORD;
    delete process.env.APP_USERNAME;
  });

  it("lets everything through when APP_PASSWORD is unset", () => {
    expect(middleware(request()).status).toBe(200);
  });

  it("challenges requests without valid credentials", () => {
    process.env.APP_PASSWORD = "s3cret";
    const res = middleware(request());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic /);
    expect(middleware(request(basic("admin", "wrong"))).status).toBe(401);
    expect(middleware(request(basic("other", "s3cret"))).status).toBe(401);
    expect(middleware(request("Basic %%%")).status).toBe(401);
  });

  it("accepts the right credentials, including non-ASCII passwords", () => {
    process.env.APP_PASSWORD = "pässwörd";
    process.env.APP_USERNAME = "mike";
    expect(middleware(request(basic("mike", "pässwörd"))).status).toBe(200);
  });
});
