import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  getDb,
  chatsTable,
  documentsTable,
  apiCallsTable,
  agentMemoriesTable,
  settingsTable,
} from "@/db";
import { DEFAULT_LIMITS } from "@/lib/rag/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS = [
  "clear_chats",
  "clear_documents",
  "clear_usage_history",
  "reset_limits",
  "clear_memory",
] as const;
type Action = (typeof VALID_ACTIONS)[number];

// Every action here is destructive and irreversible — this route exists
// specifically for the Danger Zone, which requires the UI to have already
// gotten a typed confirmation before ever calling it. There's no "are you
// sure" here; that already happened client-side.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action as Action;

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const db = getDb();

    switch (action) {
      case "clear_chats": {
        // Cascades to chat_messages and stage_timings referencing them.
        await db.delete(chatsTable);
        return NextResponse.json({ ok: true, message: "All chats deleted." });
      }
      case "clear_documents": {
        // Cascades to chunks referencing them.
        await db.delete(documentsTable);
        return NextResponse.json({ ok: true, message: "All documents deleted." });
      }
      case "clear_usage_history": {
        await db.delete(apiCallsTable);
        return NextResponse.json({ ok: true, message: "API usage history cleared." });
      }
      case "reset_limits": {
        await db
          .update(settingsTable)
          .set({
            cohereMonthlyCap: DEFAULT_LIMITS.cohereMonthlyCap,
            coherePerMinuteCap: DEFAULT_LIMITS.coherePerMinuteCap,
            openrouterPerMinuteCap: DEFAULT_LIMITS.openrouterPerMinuteCap,
            openrouterDailyCap: DEFAULT_LIMITS.openrouterDailyCap,
            agentMaxSteps: DEFAULT_LIMITS.agentMaxSteps,
            updatedAt: new Date(),
          })
          .where(eq(settingsTable.id, 1));
        return NextResponse.json({ ok: true, message: "Usage limits reset to defaults." });
      }
      case "clear_memory": {
        await db.delete(agentMemoriesTable);
        return NextResponse.json({ ok: true, message: "All memory entries deleted." });
      }
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to complete that action" },
      { status: 500 }
    );
  }
}
