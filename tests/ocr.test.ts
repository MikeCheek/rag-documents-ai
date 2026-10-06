import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { extractText } from "@/lib/rag/extract-text";
import { ocrPdfPages, pagesNeedingOcr } from "@/lib/rag/ocr";
import { makeImagePdf, makePdf } from "./helpers/make-pdf";

/** A page "photo": black text on white, as a JPEG. */
function scannedPage(lines: string[]) {
  const width = 1224;
  const height = 1584;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "black";
  ctx.font = "48px sans-serif";
  lines.forEach((line, i) => ctx.fillText(line, 120, 200 + i * 80));
  return { jpeg: canvas.toBuffer("image/jpeg"), width, height };
}

describe("pagesNeedingOcr", () => {
  it("picks pages with (almost) no text layer", () => {
    expect(pagesNeedingOcr(["Plenty of real text on this page.", "", "  12 ", "More real text here, enough."])).toEqual([2, 3]);
  });
});

describe("OCR of a scanned PDF (real tesseract, offline)", () => {
  it(
    "extracts text from image-only pages, in English and Italian",
    async () => {
      const pdf = makeImagePdf([
        scannedPage(["Mitochondria produce ATP through", "oxidative phosphorylation."]),
        scannedPage(["I mitocondri producono energia", "per la cellula."]),
      ]);

      const { pages } = await extractText(pdf, "scan.pdf", "application/pdf");
      expect(pages).toEqual(["", ""]);
      expect(pagesNeedingOcr(pages!)).toEqual([1, 2]);

      const progress: string[] = [];
      const text = await ocrPdfPages(new Uint8Array(pdf), [1, 2], (done, total) => {
        progress.push(`${done}/${total}`);
      });
      expect(progress).toEqual(["1/2", "2/2"]);
      expect(text.get(1)).toMatch(/Mitochondria produce ATP/);
      expect(text.get(1)).toMatch(/oxidative phosphorylation/);
      expect(text.get(2)).toMatch(/mitocondri producono energia/);
    },
    120_000
  );

  it("leaves pages with a text layer alone", async () => {
    const pdf = makePdf([["This page has a perfectly good text layer."]]);
    const { pages } = await extractText(pdf, "doc.pdf", "application/pdf");
    expect(pagesNeedingOcr(pages!)).toEqual([]);
  });
});
