import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq, gte, desc } from "drizzle-orm";
import { getDb, chatMessagesTable } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prepares an edit of the last user message: deactivates that message and
// everything after it (in practice, just the assistant reply) rather than
// deleting anything, tagging them with an edit_group_id shared across
// every version so far — reusing the existing group if this message has
// already been edited before, or creating a new one on the first edit.
// The caller (ChatView) then resends the edited text through the normal
// /api/chat flow with this same editGroupId, which inserts the new
// version tagged the same way and marked active.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();

    const [lastUserMessage] = await db
      .select({ id: chatMessagesTable.id, editGroupId: chatMessagesTable.editGroupId })
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.chatId, params.id),
          eq(chatMessagesTable.role, "user"),
          eq(chatMessagesTable.isActiveVersion, true)
        )
      )
      .orderBy(desc(chatMessagesTable.id))
      .limit(1);

    if (!lastUserMessage) {
      return NextResponse.json({ error: "No message to edit in this chat" }, { status: 404 });
    }

    const editGroupId = lastUserMessage.editGroupId ?? randomUUID();

    await db
      .update(chatMessagesTable)
      .set({ editGroupId, isActiveVersion: false })
      .where(
        and(
          eq(chatMessagesTable.chatId, params.id),
          eq(chatMessagesTable.isActiveVersion, true),
          gte(chatMessagesTable.id, lastUserMessage.id)
        )
      );

    return NextResponse.json({ ok: true, editGroupId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to prepare the edit" },
      { status: 500 }
    );
  }
}
