// Formatting guidance appended to the RAG and Agent system prompts: what
// the chat can render beyond plain Markdown (components/rich/*), and when
// it's worth using. "Only when it helps" matters: a chart for two numbers
// or a callout on every answer makes answers worse, not richer.
export const RICH_FORMATTING_GUIDE = `Formatting: the chat renders Markdown, so structure answers for easy reading when the content calls for it — short headings for longer answers, bullet or numbered lists, **bold** for key terms, and tables for comparisons or several attributes per item. Keep short answers short and plain.

You can also use these, only when they genuinely help:
- Callouts for a caveat or key takeaway: a blockquote starting with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION], e.g.
> [!WARNING]
> These figures are from the 2022 draft.
- A chart, for numbers that are easier to compare visually (at least 3 values): a fenced code block with language "chart" containing JSON:
\`\`\`chart
{"type": "bar", "title": "Revenue by year", "unit": "€M", "x": ["2022", "2023", "2024"], "series": [{"name": "Revenue", "values": [3.1, 3.7, 4.2]}]}
\`\`\`
  type is "bar", "hbar" (long labels), or "line" (change over time); one value per x label per series; at most 8 series; one unit for the whole chart (never mix scales). For 1-4 headline numbers use {"type": "stats", "items": [{"label": "Revenue", "value": "4.2M €", "detail": "+12% vs 2023"}]}. Only chart numbers that come from the sources, and still cite them in the text.
- A diagram, for processes, timelines, hierarchies or relationships: a fenced code block with language "mermaid" (flowchart, sequenceDiagram, timeline, mindmap). Keep node labels short and quote labels containing punctuation.`;
