import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, desc } from "drizzle-orm";
import { getDb, chatMessagesTable } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deletes the most recent user message in this chat, and everything after
// it (in practice, just the assistant reply that followed) — the backend
// half of "edit your last message": the client removes the same range
// from its own state, then resends the edited text as a fresh turn, so
// everything before the edited message is untouched. Only the *last* user
// message is ever a target here — there's no messageId in this route on
// purpose, so the client never needs to know a message's real database id
// (it doesn't, for anything sent this session rather than loaded from
// history) and there's no way to trim anything but the true last turn.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();

    const [lastUserMessage] = await db
      .select({ id: chatMessagesTable.id })
      .from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.chatId, params.id), eq(chatMessagesTable.role, "user")))
      .orderBy(desc(chatMessagesTable.id))
      .limit(1);

    if (!lastUserMessage) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    const deleted = await db
      .delete(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.chatId, params.id),
          gte(chatMessagesTable.id, lastUserMessage.id)
        )
      )
      .returning({ id: chatMessagesTable.id });

    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to trim the last turn" },
      { status: 500 }
    );
  }
}
