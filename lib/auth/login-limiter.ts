import { and, asc, eq, gt, lt, or } from "drizzle-orm";
import { getDb, loginFailuresTable } from "@/db";

// Limits failed sign-in attempts per client, so the password can't be
// guessed quickly: after MAX_FAILURES failures within WINDOW_MS, that
// client is refused until the oldest failure ages out.
//
// Failures are stored in Postgres (login_failures), so a restart doesn't
// reset the count and several server processes share it. If the database
// can't be reached, it falls back to counting in memory rather than
// locking everyone out of the sign-in page.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

const memory = new Map<string, number[]>();

function memoryRecent(key: string, now: number): number[] {
  const list = (memory.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) memory.set(key, list);
  else memory.delete(key);
  return list;
}

let warned = false;
async function withFallback<T>(fromDb: () => Promise<T>, fromMemory: () => T): Promise<T> {
  try {
    return await fromDb();
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn("Login rate limit: database unavailable, counting failures in memory instead.", err);
    }
    return fromMemory();
  }
}

/** Milliseconds until this client may try again, or 0 if it may now. */
export async function retryAfterMs(key: string, now = Date.now()): Promise<number> {
  const fromList = (times: number[]) => (times.length >= MAX_FAILURES ? times[0] + WINDOW_MS - now : 0);
  return withFallback(
    async () => {
      const rows = await getDb()
        .select({ failedAt: loginFailuresTable.failedAt })
        .from(loginFailuresTable)
        .where(and(eq(loginFailuresTable.clientKey, key), gt(loginFailuresTable.failedAt, new Date(now - WINDOW_MS))))
        .orderBy(asc(loginFailuresTable.failedAt))
        .limit(MAX_FAILURES);
      return fromList(rows.map((r) => r.failedAt.getTime()));
    },
    () => fromList(memoryRecent(key, now))
  );
}

export async function recordFailure(key: string, now = Date.now()): Promise<void> {
  await withFallback(
    async () => {
      const db = getDb();
      await db.insert(loginFailuresTable).values({ clientKey: key, failedAt: new Date(now) });
      // Housekeeping: drop this client's expired rows, and anyone's old ones.
      await db
        .delete(loginFailuresTable)
        .where(
          or(
            and(eq(loginFailuresTable.clientKey, key), lt(loginFailuresTable.failedAt, new Date(now - WINDOW_MS))),
            lt(loginFailuresTable.failedAt, new Date(now - 24 * 3600 * 1000))
          )
        );
    },
    () => void memory.set(key, [...memoryRecent(key, now), now])
  );
}

export async function clearFailures(key: string): Promise<void> {
  await withFallback(
    async () => void (await getDb().delete(loginFailuresTable).where(eq(loginFailuresTable.clientKey, key))),
    () => void memory.delete(key)
  );
}
