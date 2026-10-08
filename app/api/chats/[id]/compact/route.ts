import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, chatsTable } from "@/db";
import { isUuid } from "@/lib/utils";
import { describeError } from "@/lib/db-errors";
import { compactChat } from "@/lib/rag/compaction";
import { getContextUsage } from "@/lib/rag/chats";
import { getSettings } from "@/lib/rag/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Compact now": folds older messages into the chat's summary right away,
// instead of waiting for the context to fill up.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    const [chat] = await getDb().select({ id: chatsTable.id }).from(chatsTable).where(eq(chatsTable.id, params.id));
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const result = await compactChat(params.id, { force: true });
    const settings = await getSettings();
    const context = await getContextUsage(params.id, settings.openrouterModel);
    return NextResponse.json({ ...result, context });
  } catch (err) {
    return NextResponse.json({ error: describeError(err, "Compaction failed") }, { status: 500 });
  }
}
