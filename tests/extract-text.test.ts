import { describe, expect, it } from "vitest";
import { extractText } from "@/lib/rag/extract-text";
import { chunkPages } from "@/lib/rag/chunk";
import { makePdf } from "./helpers/make-pdf";

describe("extractText (PDF)", () => {
  it("keeps one text entry per page, in order", async () => {
    const pdf = makePdf([["First page text."], ["Second page text."], ["Third page text."]]);
    const { pages, text } = await extractText(pdf, "doc.pdf", "application/pdf");
    expect(pages).toEqual(["First page text.", "Second page text.", "Third page text."]);
    expect(text).toContain("Second page text.");
  });

  it("rejoins words hyphenated across a line break", async () => {
    const pdf = makePdf([["The mitochon-", "dria are here. A well-", "Known name."]]);
    const { pages } = await extractText(pdf, "doc.pdf", "application/pdf");
    // Lowercase continuation = a split word; uppercase = a real hyphen kept.
    expect(pages![0]).toBe("The mitochondria are here. A well-\nKnown name.");
  });

  it("explains a PDF with no text layer instead of a generic failure", async () => {
    const pdf = makePdf([[], []]);
    await expect(extractText(pdf, "scan.pdf", "application/pdf")).rejects.toThrow(/no text layer[\s\S]*OCR/);
  });

  it("returns no pages for unpaged formats", async () => {
    const res = await extractText(Buffer.from("plain text"), "a.txt", "text/plain");
    expect(res).toEqual({ text: "plain text", pages: null });
  });
});

describe("chunkPages", () => {
  const sentence = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ") + ".";

  it("records the page range each chunk spans", () => {
    const pages = [1, 2, 3, 4].map((p) => [sentence(30, `p${p}a`), sentence(30, `p${p}b`)].join(" "));
    const chunks = chunkPages(pages, { chunkSize: 100, overlap: 0 });
    for (const c of chunks) {
      const seen = [...c.content.matchAll(/p(\d)[ab]0/g)].map((m) => Number(m[1]));
      expect(c.pageStart).toBe(Math.min(...seen));
      expect(c.pageEnd).toBe(Math.max(...seen));
    }
    // Chunks flow across page breaks rather than stopping at each one.
    expect(chunks.some((c) => c.pageStart !== c.pageEnd)).toBe(true);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[chunks.length - 1].pageEnd).toBe(4);
  });

  it("skips empty pages without breaking numbering", () => {
    const chunks = chunkPages(["", "Only on page two."], { chunkSize: 100, overlap: 0 });
    expect(chunks).toEqual([{ content: "Only on page two.", pageStart: 2, pageEnd: 2 }]);
  });
});
