import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { documentsTable } from "@/db";
import { currentEmbeddingModel, LEGACY_EMBEDDING_MODEL } from "./embeddings";

/**
 * SQL condition for a document whose chunks can be compared with a query
 * right now: fully processed, and embedded with the current model (vectors
 * from two different models live in different spaces, so mixing them would
 * return confidently wrong neighbors). `table` lets callers pass an alias.
 */
export function searchableDocument(
  table: { status: AnyPgColumn; embeddingModel: AnyPgColumn } = documentsTable
) {
  return and(
    eq(table.status, "ready"),
    sql`coalesce(${table.embeddingModel}, ${LEGACY_EMBEDDING_MODEL}) = ${currentEmbeddingModel()}`
  );
}
