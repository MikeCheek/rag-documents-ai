import { describe, expect, it } from "vitest";
import { NEIGHBOR_WORDS, overlapWords, stitch } from "@/lib/rag/context";

const w = (s: string) => s.split(" ");

describe("overlapWords", () => {
  it("finds the repeated words at a chunk boundary", () => {
    expect(overlapWords(w("a b c d e"), w("d e f g"))).toBe(2);
    expect(overlapWords(w("a b c"), w("x y z"))).toBe(0);
  });
});

describe("stitch", () => {
  it("joins neighbors without repeating the overlap", () => {
    expect(stitch("one two three four", "three four five six", "five six seven eight")).toBe(
      "one two three four five six seven eight"
    );
  });

  it("works with a missing neighbor on either side", () => {
    expect(stitch(null, "main text", "text more")).toBe("main text more");
    expect(stitch("before main", "main text", null)).toBe("before main text");
  });

  it("keeps only the part of each neighbor nearest the source", () => {
    const prev = Array.from({ length: 300 }, (_, i) => `p${i}`).join(" ");
    const next = Array.from({ length: 300 }, (_, i) => `n${i}`).join(" ");
    const out = stitch(prev, "MAIN", next).split(" ");
    expect(out[0]).toBe("…");
    expect(out[1]).toBe(`p${300 - NEIGHBOR_WORDS}`);
    expect(out[NEIGHBOR_WORDS + 1]).toBe("MAIN");
    expect(out[NEIGHBOR_WORDS + 2]).toBe("n0");
    expect(out[out.length - 1]).toBe("…");
  });
});
