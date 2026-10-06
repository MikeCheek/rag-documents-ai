import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble } from "@/components/MessageBubble";
import type { ChatMessage } from "@/types";

// Renders the real chat message component to HTML: covers the whole
// markdown -> remark/rehype plugins -> React components path, which unit
// tests of the individual plugins can't (e.g. a property name that the
// syntax tree has but the component never receives).
function render(message: Partial<ChatMessage>) {
  return renderToStaticMarkup(
    createElement(MessageBubble, {
      message: { id: "1", role: "assistant", content: "", ...message } as ChatMessage,
      onCiteClick: () => {},
    })
  );
}

describe("assistant message rendering", () => {
  const html = render({
    content: [
      "## Overview",
      "",
      "> [!WARNING]",
      "> Draft figures.",
      "",
      "```chart",
      '{"type":"bar","title":"Revenue","x":["2022","2023"],"series":[{"name":"A","values":[1,2]},{"name":"B","values":[3,4]}]}',
      "```",
      "",
      "```chart",
      '{"type":"stats","items":[{"label":"Users","value":"1,250"}]}',
      "```",
      "",
      "```python",
      "def f(x):",
      "    return x",
      "```",
      "",
      "```chart",
      "{not json",
      "```",
    ].join("\n"),
  });

  it("renders callouts with a title naming their kind", () => {
    expect(html).toContain('class="callout callout-warning"');
    expect(html).toContain(">Warning</p>");
    expect(html).not.toContain("[!WARNING]");
  });

  it("renders chart blocks as charts with a legend for several series", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain("<figcaption");
    expect(html).toMatch(/Revenue/);
    expect(html).toContain("var(--series-1)");
    expect(html).toContain("var(--series-2)");
  });

  it("renders stats tiles", () => {
    expect(html).toContain("1,250");
  });

  it("highlights code with a language label and copy button", () => {
    expect(html).toContain("hljs");
    expect(html).toMatch(/>python</i);
    expect(html).toContain('aria-label="Copy code"');
  });

  it("shows invalid charts as an error with the source, not a crash", () => {
    expect(html).toContain("Couldn&#x27;t draw this chart");
    expect(html).toContain("{not json");
  });
});

describe("user message rendering", () => {
  it("shows the Search in scope under the question", () => {
    const html = render({
      role: "user",
      content: "What was the total?",
      documentScope: [{ id: "1", name: "invoices-2024.pdf" }],
    });
    expect(html).toContain("Searched in");
    expect(html).toContain("invoices-2024.pdf");
  });
});
