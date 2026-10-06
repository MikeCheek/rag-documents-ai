import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";
import { extractText, isSupportedFile } from "@/lib/rag/extract-text";
import { pagesNeedingOcr } from "@/lib/rag/ocr";
import { enqueueJob } from "@/lib/jobs/queue";
import { createEventStream } from "@/lib/stream";
import { describeError } from "@/lib/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Each file is read fully into memory and processed within this request,
// so an unbounded upload could exhaust the server's memory or run past
// maxDuration. Override with MAX_UPLOAD_MB in .env.local.
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024;

export async function POST(req: NextRequest) {
  const { stream, send, close } = createEventStream();

  (async () => {
    try {
      const formData = await req.formData();
      const files = formData.getAll("files").filter((f): f is File => f instanceof File);

      if (files.length === 0) {
        send({ type: "error", message: "No files were uploaded." });
        close();
        return;
      }

      const db = getDb();

      for (const file of files) {
        if (!isSupportedFile(file.name, file.type)) {
          send({
            type: "error",
            message: `${file.name}: unsupported file type. Use PDF, DOCX, TXT, MD, or CSV.`,
          });
          continue;
        }

        if (file.size > MAX_UPLOAD_BYTES) {
          send({
            type: "error",
            message: `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB is over the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB upload limit (MAX_UPLOAD_MB).`,
          });
          continue;
        }

        send({ type: "stage", stage: "reading", detail: file.name });

        const [doc] = await db
          .insert(documentsTable)
          .values({
            name: file.name,
            fileType: file.name.split(".").pop()?.toLowerCase() || "txt",
            status: "queued",
            stage: "queued",
          })
          .returning();

        send({ type: "document", document: serializeDoc(doc) });

        // Only text extraction happens in this request (seconds, even for
        // big files). OCR, chunking and embedding run in the background
        // worker (lib/jobs/worker.ts), so they're not bound by this
        // request's time limit and carry on if the browser goes away. The
        // Shelf shows their progress.
        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          const extracted = await extractText(buffer, file.name, file.type);
          const needsOcr = extracted.pages ? pagesNeedingOcr(extracted.pages).length > 0 : false;

          if (!extracted.text.trim() && !needsOcr) {
            throw new Error("No extractable text was found in this file.");
          }

          await enqueueJob({
            type: "ingest",
            documentId: doc.id,
            payload: extracted.pages
              ? { pages: extracted.pages, text: null }
              : { pages: null, text: extracted.text },
            // The original PDF is only kept when pages must be rendered for OCR.
            file: needsOcr ? buffer : undefined,
          });
        } catch (fileErr: any) {
          console.error(`Failed to read ${file.name}:`, fileErr);
          const [failed] = await db
            .update(documentsTable)
            .set({ status: "failed", stage: null, error: describeError(fileErr, "Processing failed") })
            .where(eq(documentsTable.id, doc.id))
            .returning();
          send({ type: "document", document: serializeDoc(failed) });
        }
      }

      send({ type: "done" });
    } catch (err: any) {
      console.error("Upload route failed:", err);
      send({ type: "error", message: describeError(err, "Upload failed") });
    } finally {
      close();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function serializeDoc(doc: any) {
  return {
    id: doc.id,
    name: doc.name,
    fileType: doc.fileType,
    status: doc.status,
    error: doc.error,
    chunkCount: doc.chunkCount,
    charCount: doc.charCount,
    language: doc.language,
    stage: doc.stage,
    progressDone: doc.progressDone,
    progressTotal: doc.progressTotal,
    createdAt: doc.createdAt,
  };
}
