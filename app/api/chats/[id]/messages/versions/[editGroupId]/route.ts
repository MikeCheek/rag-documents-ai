import { NextRequest, NextResponse } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { getDb, chatMessagesTable } from "@/db";
import type { MessageVersion, StoredChatMessage } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStored(row: typeof chatMessagesTable.$inferSelect): StoredChatMessage {
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role as StoredChatMessage["role"],
    content: row.content,
    mode: row.mode as StoredChatMessage["mode"],
    sources: row.sources as StoredChatMessage["sources"],
    rerankMethod: row.rerankMethod,
    agentSteps: row.agentSteps as StoredChatMessage["agentSteps"],
    apiCallCount: row.apiCallCount,
    durationMs: row.durationMs,
    editGroupId: row.editGroupId,
    createdAt: row.createdAt.toISOString(),
  };
}

// Every version of an edited turn, oldest first — messages sharing one
// edit_group_id are always inserted in (user, assistant) pairs, in order,
// so pairing up the flat, id-ordered list two at a time reconstructs each
// version without needing a separate "version number" column.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; editGroupId: string } }
) {
  try {
    const db = getDb();

    const rows = await db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.chatId, params.id),
          eq(chatMessagesTable.editGroupId, params.editGroupId)
        )
      )
      .orderBy(asc(chatMessagesTable.id));

    const versions: MessageVersion[] = [];
    for (let i = 0; i < rows.length; i += 2) {
      const userRow = rows[i];
      const assistantRow = rows[i + 1];
      if (!userRow || userRow.role !== "user") continue; // defensive; shouldn't happen given the insert pattern
      versions.push({
        index: versions.length,
        userMessage: toStored(userRow),
        assistantMessage: assistantRow ? toStored(assistantRow) : null,
      });
    }

    return NextResponse.json({ versions });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load versions" },
      { status: 500 }
    );
  }
}
