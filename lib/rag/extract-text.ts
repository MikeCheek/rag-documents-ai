// Extracts plain text from an uploaded file's raw bytes, based on its type.

// Postgres's text/UTF8 columns reject the null byte (0x00) outright, and it
// occasionally leaks into extracted text — most often from PDFs with
// unusual font/encoding tables. Other C0 control characters (besides
// tab/newline/carriage-return) are stripped too, since they're never
// meaningful prose and can trip up the same class of encoding issue.
function sanitizeExtractedText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export async function extractText(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  let text: string;

  if (ext === "pdf" || mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    text = result.text;
  } else if (
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

  return sanitizeExtractedText(text);
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
