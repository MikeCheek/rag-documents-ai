import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  documentsTable,
  chunksTable,
  apiCallsTable,
  chatsTable,
  chatMessagesTable,
  settingsTable,
  agentToolsTable,
  toolCallLogTable,
  agentMemoriesTable,
  stageTimingsTable,
} from "./schema";

const schema = {
  documents: documentsTable,
  chunks: chunksTable,
  apiCalls: apiCallsTable,
  chats: chatsTable,
  chatMessages: chatMessagesTable,
  settings: settingsTable,
  agentTools: agentToolsTable,
  toolCallLog: toolCallLogTable,
  agentMemories: agentMemoriesTable,
  stageTimings: stageTimingsTable,
};

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

// Lazily created so the module can be imported (e.g. during `next build`)
// even when DATABASE_URL isn't set yet. The clear error only surfaces
// when a route actually tries to talk to the database.
export function getDb() {
  if (_db) return _db;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example)."
    );
  }

  const client = postgres(databaseUrl, { prepare: false });
  _db = drizzle(client, { schema });
  return _db;
}

export {
  documentsTable,
  chunksTable,
  apiCallsTable,
  chatsTable,
  chatMessagesTable,
  settingsTable,
  agentToolsTable,
  toolCallLogTable,
  agentMemoriesTable,
  stageTimingsTable,
};
