import { NextRequest, NextResponse } from "next/server";
import { importSpec, parseSpecText } from "@/lib/agent/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SPEC_BYTES = 5 * 1024 * 1024;

/**
 * Reads an OpenAPI/Swagger document (from a URL, or pasted) and returns
 * the operations it describes as tool definitions, for the user to pick
 * from. Nothing is saved here.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const specUrl = typeof body?.url === "string" && body.url.trim() ? body.url.trim() : undefined;
    let text = typeof body?.text === "string" ? body.text : "";

    if (specUrl) {
      // Fetched on the user's explicit request (not the model's), so a spec
      // served by a local API is fine to read.
      const res = await fetch(specUrl, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json, application/yaml, text/yaml, */*" } });
      if (!res.ok) throw new Error(`Fetching the spec failed: HTTP ${res.status}`);
      text = await res.text();
    }
    if (!text.trim()) return NextResponse.json({ error: "Paste a spec or give its URL." }, { status: 400 });
    if (text.length > MAX_SPEC_BYTES) return NextResponse.json({ error: "That spec is too large (5 MB max)." }, { status: 400 });

    let spec: any;
    try {
      spec = await parseSpecText(text);
    } catch (err: any) {
      return NextResponse.json({ error: `Couldn't parse the spec as JSON or YAML: ${err?.message}` }, { status: 400 });
    }
    return NextResponse.json(importSpec(spec, specUrl));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Import failed" }, { status: 400 });
  }
}
