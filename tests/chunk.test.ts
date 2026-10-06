import { describe, expect, it } from "vitest";
import { chunkText, splitSentences } from "@/lib/rag/chunk";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const sentence = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ") + ".";

describe("splitSentences", () => {
  it("splits on sentence punctuation and paragraph breaks", () => {
    expect(splitSentences('One. Two? "Three!" Four\n\nFive')).toEqual([
      "One.",
      "Two?",
      '"Three!"',
      "Four",
      "Five",
    ]);
  });
});

describe("chunkText", () => {
  it("returns nothing for empty text", () => {
    expect(chunkText("   \n\n ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    expect(chunkText("Hello world. Second sentence.")).toEqual(["Hello world. Second sentence."]);
  });

  it("never exceeds the chunk size and never splits a sentence that fits", () => {
    const text = Array.from({ length: 40 }, (_, i) => sentence(25, `s${i}w`)).join(" ");
    const chunks = chunkText(text, { chunkSize: 100, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(words(c)).toBeLessThanOrEqual(100);
      // Every chunk starts at a sentence start and ends at a sentence end.
      expect(c).toMatch(/^s\d+w0 /);
      expect(c.endsWith(".")).toBe(true);
    }
  });

  it("carries the previous chunk's last sentence over as overlap", () => {
    const text = Array.from({ length: 12 }, (_, i) => sentence(20, `s${i}w`)).join(" ");
    const chunks = chunkText(text, { chunkSize: 100, overlap: 25 });
    for (let i = 1; i < chunks.length; i++) {
      const prevSentences = splitSentences(chunks[i - 1]);
      expect(chunks[i].startsWith(prevSentences[prevSentences.length - 1])).toBe(true);
    }
  });

  it("covers every sentence of the input", () => {
    const sentences = Array.from({ length: 30 }, (_, i) => sentence(15, `s${i}w`));
    const chunks = chunkText(sentences.join(" "), { chunkSize: 60, overlap: 15 });
    for (const s of sentences) expect(chunks.some((c) => c.includes(s))).toBe(true);
  });

  it("hard-splits a single sentence longer than a chunk", () => {
    const chunks = chunkText(sentence(250, "w"), { chunkSize: 100, overlap: 20 });
    expect(chunks.map(words)).toEqual([100, 100, 50]);
  });
});
