// Cleanup and repair for Mermaid diagrams written by the model.
//
// prepareMermaid() runs on every diagram: it drops styling statements
// (style / classDef / class / linkStyle and :::class suffixes). Models
// tend to hard-code light pastel fills that are unreadable in this app's
// dark theme, where node text is light; without them every diagram uses
// the app's own theme.
//
// repairMermaid() runs only when a diagram fails to parse. The most common
// failure by far is an unquoted node label containing characters that are
// Mermaid syntax, above all parentheses: `a[Intro (NeRF)]` is an error,
// `a["Intro (NeRF)"]` is fine. It quotes such labels in flowcharts, and
// renames node ids that are reserved words (`end`).

const STYLE_LINE = /^\s*(style|classDef|class|linkStyle)\s.*$/;

export function prepareMermaid(source: string): string {
  return source
    .split("\n")
    .filter((line) => !STYLE_LINE.test(line))
    .map((line) => line.replace(/:::[A-Za-z0-9_-]+/g, ""))
    .join("\n")
    .trim();
}

/** Node shapes: opening token -> closing token. Longest openers first. */
const SHAPES: [string, string][] = [
  ["(((", ")))"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
];

/** What may follow a node definition on a flowchart line. */
const AFTER_NODE = /^\s*($|;|&|-->|---|-\.|\.-|==>|===|--[^>]|~~~|<--|<==|x--|o--)/;

const RESERVED_IDS = new Set(["end", "graph", "subgraph", "flowchart", "style", "class", "classDef", "click", "default"]);

function quoteLabel(label: string): string {
  return `"${label.replace(/"/g, "#quot;")}"`;
}

/** Quotes unquoted node labels on one flowchart line, renaming reserved ids. */
function repairFlowchartLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("%%") || /^(flowchart|graph|subgraph|end$|direction)\b/.test(trimmed)) return line;

  // Edge labels (`-->|text|`) break on the same characters as node labels.
  line = line.replace(/\|([^|"]*[()[\]{}][^|"]*)\|/g, (_, text: string) => `|${quoteLabel(text.trim())}|`);

  let out = "";
  let i = 0;
  while (i < line.length) {
    // Quoted text is already safe: copy it through untouched.
    if (line[i] === '"') {
      const close = line.indexOf('"', i + 1);
      const stop = close === -1 ? line.length : close + 1;
      out += line.slice(i, stop);
      i = stop;
      continue;
    }
    const rest = line.slice(i);
    const idMatch = /^[A-Za-z0-9_][A-Za-z0-9_.-]*/.exec(rest);
    // A node id must start a token (not continue a word or an arrow).
    const prev = line[i - 1];
    if (idMatch && (i === 0 || /[\s&;>|-]/.test(prev ?? ""))) {
      let id = idMatch[0];
      const afterId = i + id.length;
      const shape = SHAPES.find(([open]) => line.startsWith(open, afterId));
      if (RESERVED_IDS.has(id) && (shape || AFTER_NODE.test(line.slice(afterId)) || /-->\s*$/.test(out))) {
        id = `${id}_`;
      }
      if (shape) {
        const [open, close] = shape;
        const labelStart = afterId + open.length;
        // The label ends at the closing token that is followed by something
        // that can legally come after a node (an arrow, &, ;, end of line):
        // skips parentheses and brackets inside the label itself.
        let end = -1;
        for (let j = line.indexOf(close, labelStart); j !== -1; j = line.indexOf(close, j + 1)) {
          if (AFTER_NODE.test(line.slice(j + close.length))) {
            end = j;
            break;
          }
        }
        if (end !== -1) {
          const label = line.slice(labelStart, end);
          const quoted = /^\s*".*"\s*$/.test(label) || label.trim() === "" ? label : quoteLabel(label.trim());
          out += id + open + quoted + close;
          i = end + close.length;
          continue;
        }
      }
      out += id;
      i = afterId;
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}

export function repairMermaid(source: string): string {
  const firstLine = source.trim().split("\n")[0]?.trim() ?? "";
  if (!/^(flowchart|graph)\b/.test(firstLine)) return source;
  return source
    .split("\n")
    .map((line, n) => (n === 0 ? line : repairFlowchartLine(line)))
    .join("\n");
}
