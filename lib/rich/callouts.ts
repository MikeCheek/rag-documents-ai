// remark plugin for GitHub-style callouts in answers:
//
//   > [!WARNING]
//   > The figures below are from the 2022 draft.
//
// The blockquote gets a `callout callout-warning` class and a title line;
// the marker itself is removed. Types: NOTE, TIP, IMPORTANT, WARNING, CAUTION.

export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i;

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, any> };

export function remarkCallouts() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (node.type === "blockquote") {
        const first = node.children?.[0];
        const text = first?.type === "paragraph" ? first.children?.[0] : undefined;
        const match = text?.type === "text" ? MARKER.exec(text.value ?? "") : null;
        if (match && text && first) {
          const kind = match[1].toLowerCase();
          text.value = (text.value ?? "").slice(match[0].length);
          // Drop a now-empty first text node (and a leading line break).
          if (!text.value) {
            first.children!.shift();
            if (first.children![0]?.type === "break") first.children!.shift();
          }
          if (first.children!.length === 0) node.children!.shift();
          node.data = {
            ...(node.data ?? {}),
            hProperties: { className: ["callout", `callout-${kind}`], dataCallout: kind },
          };
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
