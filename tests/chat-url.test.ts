import { describe, expect, it } from "vitest";
import { chatIdFromPath } from "@/app/(chat)/ChatWorkspace";
import { isUuid } from "@/lib/utils";

describe("chatIdFromPath", () => {
  it.each([
    ["/", null],
    [null, null],
    ["/chat/11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"],
    ["/chat/abc/", "abc"],
    ["/chat/a%20b", "a b"],
    ["/chat/abc/extra", null],
    ["/shelf", null],
  ])("%s -> %s", (path, id) => {
    expect(chatIdFromPath(path)).toBe(id);
  });
});

describe("isUuid", () => {
  it("accepts UUIDs and rejects anything else", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("not-a-real-id")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
