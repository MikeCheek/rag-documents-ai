import { describe, expect, it } from "vitest";
import { firstHitRank, summarize, validateCases } from "@/lib/eval/score";

const r = (documentName: string, content: string) => ({ documentName, content });

describe("firstHitRank", () => {
  const c = { question: "q", document: "Bio.pdf", contains: "oxidative  Phosphorylation" };

  it("matches document case-insensitively and phrase ignoring case/whitespace", () => {
    expect(firstHitRank(c, [r("other.pdf", "oxidative phosphorylation"), r("bio.pdf", "via OXIDATIVE\nphosphorylation")])).toBe(2);
  });

  it("requires the phrase when given", () => {
    expect(firstHitRank(c, [r("Bio.pdf", "unrelated")])).toBeNull();
  });

  it("matches on document alone without a phrase", () => {
    expect(firstHitRank({ question: "q", document: "a.txt" }, [r("a.txt", "x")])).toBe(1);
  });
});

describe("summarize", () => {
  it("computes hit@1, hit@k and MRR", () => {
    expect(summarize([1, 2, null, 4])).toEqual({ cases: 4, hitAt1: 0.25, hitAtK: 0.75, mrr: (1 + 0.5 + 0 + 0.25) / 4 });
  });
});

describe("validateCases", () => {
  it("rejects malformed input", () => {
    expect(() => validateCases({})).toThrow(/array/);
    expect(() => validateCases([{ question: "q" }])).toThrow(/Case 1/);
  });
});
