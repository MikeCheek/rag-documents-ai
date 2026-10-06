import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The login rate limit against real Postgres: failures are stored, so
// they're shared across processes and survive a restart.
const url = process.env.TEST_DATABASE_URL;
const KEY = `limiter-test-${Date.now()}`;

describe.skipIf(!url)("login limiter (real Postgres)", () => {
  let limiter: typeof import("@/lib/auth/login-limiter");
  let schema: typeof import("@/db");
  let orm: typeof import("drizzle-orm");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    limiter = await import("@/lib/auth/login-limiter");
    schema = await import("@/db");
    orm = await import("drizzle-orm");
  });

  afterAll(async () => {
    await schema?.getDb().delete(schema.loginFailuresTable).where(orm.like(schema.loginFailuresTable.clientKey, `${KEY}%`));
  });

  const rows = (key: string) =>
    schema.getDb().select().from(schema.loginFailuresTable).where(orm.eq(schema.loginFailuresTable.clientKey, key));

  it("stores failures and locks the client out after too many", async () => {
    const { MAX_FAILURES, WINDOW_MS, recordFailure, retryAfterMs } = limiter;
    const now = Date.now();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await recordFailure(KEY, now - 60_000 + i);
    expect(await retryAfterMs(KEY, now)).toBe(0);
    await recordFailure(KEY, now);
    expect(await rows(KEY)).toHaveLength(MAX_FAILURES);
    // Locked until the oldest failure in the window ages out.
    expect(await retryAfterMs(KEY, now)).toBe(WINDOW_MS - 60_000);
    expect(await retryAfterMs(KEY, now - 60_000 + WINDOW_MS + MAX_FAILURES)).toBe(0);
    expect(await retryAfterMs(`${KEY}-other`, now)).toBe(0);
  });

  it("clears a client's failures after a successful sign-in", async () => {
    await limiter.clearFailures(KEY);
    expect(await rows(KEY)).toHaveLength(0);
    expect(await limiter.retryAfterMs(KEY)).toBe(0);
  });

  it("prunes a client's expired failures as new ones come in", async () => {
    const key = `${KEY}-old`;
    const now = Date.now();
    await limiter.recordFailure(key, now - limiter.WINDOW_MS - 1000);
    await limiter.recordFailure(key, now);
    expect(await rows(key)).toHaveLength(1);
  });
});
