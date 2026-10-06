import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "@/lib/rag/fusion";
import { toOrTsQuery } from "@/lib/rag/retrieve";

describe("reciprocalRankFusion", () => {
  it("ranks items found by both lists above items found by one", () => {
    const fused = reciprocalRankFusion([["a", "b", "c"], ["c", "d"]], (x) => x).map((r) => r.item);
    expect(fused[0]).toBe("c");
    expect(fused).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps the first list's order on ties", () => {
    const fused = reciprocalRankFusion([["a", "b"], ["b", "a"]], (x) => x).map((r) => r.item);
    expect(fused).toEqual(["a", "b"]);
  });

  it("handles empty lists", () => {
    expect(reciprocalRankFusion([[], []], (x: string) => x)).toEqual([]);
  });
});

describe("toOrTsQuery", () => {
  it("ORs distinct word tokens and drops tsquery syntax", () => {
    expect(toOrTsQuery("What's the ATP yield & (cost) of A-1 | b?")).toBe(
      "what | the | atp | yield | cost | of"
    );
  });

  it("keeps non-English letters and numbers", () => {
    expect(toOrTsQuery("Città 2024")).toBe("città | 2024");
  });

  it("returns an empty string when there are no words", () => {
    expect(toOrTsQuery("?! -- &")).toBe("");
  });
});
