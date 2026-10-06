import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkCallouts } from "@/lib/rich/callouts";

function run(md: string): any {
  const processor = unified().use(remarkParse).use(remarkCallouts);
  return processor.runSync(processor.parse(md));
}
const text = (node: any): string => (node.value ?? "") + (node.children ?? []).map(text).join("");

describe("remarkCallouts", () => {
  it("turns [!WARNING] blockquotes into callouts and removes the marker", () => {
    const quote = run("> [!WARNING]\n> These figures are from the 2022 draft.").children[0];
    expect(quote.data.hProperties).toEqual({ className: ["callout", "callout-warning"], dataCallout: "warning" });
    expect(text(quote)).toBe("These figures are from the 2022 draft.");
  });

  it("handles the marker on the same line as the text, any case", () => {
    const quote = run("> [!tip] Use hybrid search.").children[0];
    expect(quote.data.hProperties.dataCallout).toBe("tip");
    expect(text(quote)).toBe("Use hybrid search.");
  });

  it("leaves ordinary blockquotes alone", () => {
    const quote = run("> Just a quote [!NOTE] in the middle.").children[0];
    expect(quote.data).toBeUndefined();
  });
});
