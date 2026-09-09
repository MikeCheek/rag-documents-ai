import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live-tests a SearXNG URL from Settings, so setup problems (JSON not
// enabled, wrong URL, unreachable instance) surface immediately instead of
// only being discovered mid-conversation in Agent mode.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const baseUrl = String(body?.baseUrl ?? "").trim();

    if (!baseUrl) {
      return NextResponse.json({ ok: false, message: "Enter a URL first." });
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json({ ok: false, message: "URL must start with http:// or https://" });
    }

    const url = new URL("/search", baseUrl);
    url.searchParams.set("q", "test");
    url.searchParams.set("format", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });

      if (res.status === 403) {
        return NextResponse.json({
          ok: false,
          message:
            "403 Forbidden — the instance is reachable, but its JSON output format isn't enabled (most public instances disable it). Self-host with \"json\" added to search.formats in settings.yml, or find/verify a public instance that has it on.",
        });
      }
      if (!res.ok) {
        return NextResponse.json({ ok: false, message: `Instance responded with status ${res.status}.` });
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return NextResponse.json({
          ok: false,
          message: "Got a response, but it isn't JSON — JSON format is likely not enabled on this instance.",
        });
      }

      const data = await res.json();
      const count = Array.isArray(data?.results) ? data.results.length : 0;
      return NextResponse.json({ ok: true, message: `Working — got ${count} result(s) for a test query.` });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "Timed out reaching the instance." : err?.message ?? "Request failed.";
    return NextResponse.json({ ok: false, message });
  }
}
