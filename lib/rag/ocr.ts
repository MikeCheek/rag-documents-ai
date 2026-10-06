// OCR for PDF pages with no text layer (scans, photos of pages), fully
// offline: unpdf renders each page to an image (via @napi-rs/canvas) and
// tesseract.js reads it, using language data installed from npm
// (@tesseract.js-data/<lang>) rather than downloaded from a CDN at runtime.
//
// Slow (roughly 1-3 s per page), so it only ever runs in the background
// worker (lib/jobs/worker.ts), never inside a request.
//
// Languages: OCR_LANGUAGES in .env.local, tesseract codes joined by "+"
// (default "eng+ita"). Each needs its package installed, e.g.
// `npm install @tesseract.js-data/fra` for French.

import { copyFile, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Pages whose text layer has fewer characters than this are OCR'd. */
export const MIN_TEXT_CHARS_PER_PAGE = 20;

export function ocrLanguages(): string[] {
  return (process.env.OCR_LANGUAGES || "eng+ita")
    .split("+")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 1-based numbers of the pages that need OCR. */
export function pagesNeedingOcr(pages: string[]): number[] {
  return pages
    .map((text, i) => (text.replace(/\s+/g, "").length < MIN_TEXT_CHARS_PER_PAGE ? i + 1 : null))
    .filter((p): p is number => p !== null);
}

/**
 * tesseract.js loads every language from one directory, but each npm data
 * package has its own; copy them into one shared directory (once).
 */
async function languageDataDir(languages: string[]): Promise<string> {
  const dir = path.join(os.tmpdir(), "reading-room-tessdata");
  await mkdir(dir, { recursive: true });

  for (const lang of languages) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    const exists = await stat(target).then(() => true, () => false);
    if (exists) continue;

    // Located by path rather than require.resolve, which webpack rewrites
    // in the server bundle. The server always runs from the project root.
    const source = path.join(
      process.cwd(),
      "node_modules",
      "@tesseract.js-data",
      lang,
      "4.0.0",
      `${lang}.traineddata.gz`
    );
    try {
      await stat(source);
    } catch {
      throw new Error(
        `OCR language "${lang}" isn't installed. Run \`npm install @tesseract.js-data/${lang}\`, or change OCR_LANGUAGES.`
      );
    }
    await copyFile(source, target);
  }
  return dir;
}

/**
 * OCRs the given 1-based pages of a PDF. Returns page number -> text.
 * `onPage` reports progress after each page.
 */
export async function ocrPdfPages(
  pdf: Uint8Array,
  pageNumbers: number[],
  onPage?: (done: number, total: number) => void | Promise<void>
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  if (pageNumbers.length === 0) return results;

  const languages = ocrLanguages();
  const langPath = await languageDataDir(languages);
  const { createWorker } = await import("tesseract.js");
  const { renderPageAsImage } = await import("unpdf");

  const worker = await createWorker(languages, 1, {
    langPath,
    cacheMethod: "none",
    gzip: true,
    // Silences tesseract's per-language "special-words" warnings.
    errorHandler: () => {},
  });
  try {
    let done = 0;
    for (const page of pageNumbers) {
      // pdf.js detaches the buffer it's given, so each render gets a copy.
      const image = await renderPageAsImage(pdf.slice(), page, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 2, // ~144 dpi: small text stays legible to tesseract
      });
      const { data } = await worker.recognize(Buffer.from(image));
      results.set(page, data.text.trim());
      await onPage?.(++done, pageNumbers.length);
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
