// Extracts plain text from an uploaded file's raw bytes, based on its type.

// Postgres's text/UTF8 columns reject the null byte (0x00) outright, and it
// occasionally leaks into extracted text — most often from PDFs with
// unusual font/encoding tables. Other C0 control characters (besides
// tab/newline/carriage-return) are stripped too, since they're never
// meaningful prose and can trip up the same class of encoding issue.
function sanitizeExtractedText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export type ExtractedText = {
  text: string;
  /** One entry per page, in order — only for paged formats (PDF). */
  pages: string[] | null;
};

/** Rejoins words hyphenated across a line break ("exam-\nple" -> "example"). */
function dehyphenate(text: string): string {
  return text.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
}

export async function extractText(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ExtractedText> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf" || mimeType === "application/pdf") {
    // unpdf is a serverless build of current pdf.js. (pdf-parse, used
    // before, bundles pdf.js 1.10 from 2017, which fails to open even
    // ordinary PDFs with "bad XRef entry".)
    const { getDocumentProxy, extractText: extractPdfText } = await import("unpdf");
    // Copied into a fresh array: pdf.js takes ownership of (and detaches)
    // the buffer it's given.
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    try {
      const { text: rawPages } = await extractPdfText(pdf, { mergePages: false });
      const pages = rawPages.map((p) => sanitizeExtractedText(dehyphenate(p)));
      // Pages without a text layer (scans) come back empty here; the
      // ingestion job OCRs them (lib/rag/ocr.ts).
      const text = pages.join("\n\n");
      return { text, pages };
    } finally {
      // Frees the document and its worker-side resources.
      await pdf.loadingTask.destroy();
    }
  }

  let text: string;
  if (
    ext === "docx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (
    ext === "txt" ||
    ext === "md" ||
    ext === "markdown" ||
    ext === "csv" ||
    mimeType.startsWith("text/")
  ) {
    text = buffer.toString("utf-8");
  } else {
    throw new Error(
      `Unsupported file type "${ext || mimeType}". Supported: PDF, DOCX, TXT, MD, CSV.`
    );
  }

  return { text: sanitizeExtractedText(text), pages: null };
}

export function isSupportedFile(fileName: string, mimeType: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return (
    ["pdf", "docx", "txt", "md", "markdown", "csv"].includes(ext) ||
    mimeType === "application/pdf" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType.startsWith("text/")
  );
}
