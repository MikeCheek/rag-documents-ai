// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareMermaid, repairMermaid } from "@/lib/rich/mermaid-repair";

// Checked with Mermaid's real parser (it needs a DOM, hence jsdom).
async function parses(source: string): Promise<true | string> {
  const { default: mermaid } = await import("mermaid");
  try {
    await mermaid.parse(source);
    return true;
  } catch (err: any) {
    return String(err?.message ?? err).split("\n")[0];
  }
}

describe("repairMermaid", () => {
  it("fixes a real model-written diagram that failed to parse", async () => {
    // From a real answer: unquoted labels with parentheses, "1)" prefixes,
    // §, <br/>, non-breaking hyphens, and light pastel style lines.
    const original = readFileSync(path.join(__dirname, "fixtures/mermaid-unquoted-parens.mmd"), "utf8");
    expect(await parses(original)).not.toBe(true);

    const fixed = repairMermaid(prepareMermaid(original));
    expect(await parses(fixed)).toBe(true);
    expect(fixed).toContain('intro["Introduction<br/>– Core 3D representations<br/>(NeRF, 3DGS, Pointmap, etc.)"]');
    expect(fixed).toContain('feat["1) Feature Enhancement<br/>§4.1 – robust 2D‑to‑3D lifting"]');
    expect(fixed).not.toMatch(/^\s*style /m);
  });

  it.each([
    ['a[Intro (NeRF)] --> b', 'a["Intro (NeRF)"] --> b'],
    ['a[Apps (§6)] --> b[Next] & c{Is it (x)?}', 'a["Apps (§6)"] --> b["Next"] & c{"Is it (x)?"}'],
    ['a(Round (inner)) --> b([Stadium (s)])', 'a("Round (inner)") --> b(["Stadium (s)"])'],
    ['a["Already quoted (ok)"] --> b', 'a["Already quoted (ok)"] --> b'],
    ['a[Say "hi" (twice)] --> b', 'a["Say #quot;hi#quot; (twice)"] --> b'],
    ['start --> end[Finish (done)]', 'start --> end_["Finish (done)"]'],
    ['a -->|edge (label)| b[Node]', 'a -->|"edge (label)"| b["Node"]'],
    ['a -->|plain| b', 'a -->|plain| b'],
  ])("%s", async (line, expected) => {
    const fixed = repairMermaid(`flowchart TD\n  ${line}`);
    expect(fixed.split("\n")[1].trim()).toBe(expected);
    expect(await parses(fixed)).toBe(true);
  });

  it("leaves subgraphs, comments and non-flowcharts alone", async () => {
    const src = 'flowchart LR\n  %% a comment (with parens)\n  subgraph S1 [Group (one)]\n    a[x (y)] --> b\n  end';
    const fixed = repairMermaid(src);
    expect(fixed).toContain("%% a comment (with parens)");
    expect(fixed).toContain('a["x (y)"] --> b');
    expect(fixed.trim().endsWith("end")).toBe(true);
    const seq = "sequenceDiagram\n  A->>B: hello (world)";
    expect(repairMermaid(seq)).toBe(seq);
  });
});

describe("prepareMermaid", () => {
  it("drops styling so the app theme applies", () => {
    const out = prepareMermaid("flowchart TD\n  a:::hot --> b\n  classDef hot fill:#f00\n  style b fill:#fff\n  linkStyle 0 stroke:#000");
    expect(out).toBe("flowchart TD\n  a --> b");
  });
});
