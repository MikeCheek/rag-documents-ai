import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb, chatsTable, chatMessagesTable } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const [chat] = await db.select().from(chatsTable).where(eq(chatsTable.id, params.id));
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const messages = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.chatId, params.id))
      .orderBy(asc(chatMessagesTable.id));

    return NextResponse.json({
      chat: {
        id: chat.id,
        title: chat.title,
        pinned: chat.pinned,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      },
      messages,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load chat" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const patch: { title?: string; pinned?: boolean } = {};

    if (typeof body?.title === "string") {
      const title = body.title.trim();
      if (!title) {
        return NextResponse.json({ error: "Title can't be empty" }, { status: 400 });
      }
      patch.title = title.slice(0, 200);
    }
    if (typeof body?.pinned === "boolean") {
      patch.pinned = body.pinned;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = getDb();
    const [updated] = await db
      .update(chatsTable)
      .set(patch)
      .where(eq(chatsTable.id, params.id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    return NextResponse.json({
      chat: {
        id: updated.id,
        title: updated.title,
        pinned: updated.pinned,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to update chat" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    await db.delete(chatsTable).where(eq(chatsTable.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete chat" },
      { status: 500 }
    );
  }
}
