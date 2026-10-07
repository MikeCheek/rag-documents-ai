import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Usage totals against real Postgres, where sum() and count() come back
// as text: they must be added up as numbers, not joined ("0" + "4" = "04").
const url = process.env.TEST_DATABASE_URL;
const PURPOSE = `usage-test-${Date.now()}`;

describe.skipIf(!url)("usage snapshot (real Postgres)", () => {
  let schema: typeof import("@/db");
  let orm: typeof import("drizzle-orm");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    schema = await import("@/db");
    orm = await import("drizzle-orm");
  });

  afterAll(async () => {
    await schema?.getDb().delete(schema.apiCallsTable).where(orm.like(schema.apiCallsTable.purpose, `${PURPOSE}%`));
  });

  it("adds up all-time calls and tokens as numbers, across purposes", async () => {
    const { getUsageSnapshot } = await import("@/lib/rag/usage");
    const before = (await getUsageSnapshot()).usage.local;

    await schema.getDb().insert(schema.apiCallsTable).values([
      { provider: "local", purpose: `${PURPOSE}-a`, count: 4, tokensUsed: 10 },
      { provider: "local", purpose: `${PURPOSE}-b`, count: 3, tokensUsed: 5 },
    ]);

    const after = (await getUsageSnapshot()).usage.local;
    expect(typeof after.callsAllTime).toBe("number");
    expect(after.callsAllTime).toBe(before.callsAllTime + 7);
    expect(after.tokensAllTime).toBe(before.tokensAllTime + 15);
    expect(after.byPurpose[`${PURPOSE}-a`]).toBe(4);
  });
});
