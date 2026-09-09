import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, documentsTable, chunksTable } from "@/db";
import { extractText, isSupportedFile } from "@/lib/rag/extract-text";
import { chunkText } from "@/lib/rag/chunk";
import { generateEmbeddings } from "@/lib/rag/embeddings";
import { computeCentroid } from "@/lib/rag/clustering";
import { createEventStream } from "@/lib/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

        send({ type: "stage", stage: "reading", detail: file.name });

        const [doc] = await db
          .insert(documentsTable)
          .values({
            name: file.name,
            fileType: file.name.split(".").pop()?.toLowerCase() || "txt",
            status: "processing",
          })
          .returning();

        send({ type: "document", document: serializeDoc(doc) });

        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          const text = (await extractText(buffer, file.name, file.type)).trim();

          if (!text) {
            throw new Error("No extractable text was found in this file.");
          }

          send({ type: "stage", stage: "chunking", detail: file.name });
          const chunks = chunkText(text);

          if (chunks.length === 0) {
            throw new Error("Text extraction produced no chunks.");
          }

          send({
            type: "stage",
            stage: "embedding",
            detail: `0/${chunks.length} chunks · ${file.name}`,
          });

          const BATCH = 8;
          const embeddings: number[][] = [];
          for (let i = 0; i < chunks.length; i += BATCH) {
            const batch = chunks.slice(i, i + BATCH);
            const batchEmbeddings = await generateEmbeddings(batch);
            embeddings.push(...batchEmbeddings);
            send({
              type: "stage",
              stage: "embedding",
              detail: `${embeddings.length}/${chunks.length} chunks · ${file.name}`,
            });
          }

          send({ type: "stage", stage: "storing", detail: file.name });
          await db.insert(chunksTable).values(
            chunks.map((content, index) => ({
              documentId: doc.id,
              chunkIndex: index,
              content,
              embedding: embeddings[index],
            }))
          );

          const [updated] = await db
            .update(documentsTable)
            .set({
              status: "ready",
              chunkCount: chunks.length,
              charCount: text.length,
              centroidEmbedding: computeCentroid(embeddings),
            })
            .where(eq(documentsTable.id, doc.id))
            .returning();

          send({ type: "document", document: serializeDoc(updated) });
        } catch (fileErr: any) {
          console.error(`Failed to process ${file.name}:`, fileErr);
          const [failed] = await db
            .update(documentsTable)
            .set({ status: "failed", error: fileErr?.message ?? "Processing failed" })
            .where(eq(documentsTable.id, doc.id))
            .returning();
          send({ type: "document", document: serializeDoc(failed) });
        }
      }

      send({ type: "done" });
    } catch (err: any) {
      console.error("Upload route failed:", err);
      send({ type: "error", message: err?.message ?? "Upload failed" });
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
    createdAt: doc.createdAt,
  };
}
