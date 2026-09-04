import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, chatsTable } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: chatsTable.id,
        title: chatsTable.title,
        pinned: chatsTable.pinned,
        createdAt: chatsTable.createdAt,
        updatedAt: chatsTable.updatedAt,
      })
      .from(chatsTable)
      .orderBy(desc(chatsTable.pinned), desc(chatsTable.updatedAt));

    return NextResponse.json({ chats: rows });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load chats" },
      { status: 500 }
    );
  }
}
