// Strips markdown/LaTeX/citation syntax down to something that reads
// naturally aloud — raw markdown read literally by a speech synthesizer
// sounds like "asterisk asterisk bold asterisk asterisk", not like text.
export function toSpeakableText(markdown: string): string {
  let text = markdown;

  // Fenced code blocks and inline code — content is rarely meaningful
  // spoken aloud (variable names, syntax), so drop them with a short
  // spoken placeholder rather than reading punctuation-heavy code letter
  // by letter.
  text = text.replace(/```[\s\S]*?```/g, " (code block) ");
  text = text.replace(/`([^`]+)`/g, "$1");

  // Display and inline math — same reasoning: raw LaTeX read character by
  // character is worse than skipping it with a placeholder.
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " (equation) ");
  text = text.replace(/\$[^$\n]+\$/g, " (equation) ");

  // Citation markers like [1], [2][3] — meaningful visually, not spoken.
  text = text.replace(/\[\d+\]/g, "");

  // Markdown links -> just the link text; images -> alt text or dropped.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Headings, emphasis, strikethrough markers — keep the words, drop the
  // punctuation that signals formatting.
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, "");

  // Table syntax — dropping the pipes/separator rows isn't a faithful
  // read of a table, but it keeps the actual cell content as words
  // instead of an unreadable wall of "pipe dash pipe dash".
  text = text.replace(/^\|?-{2,}\|?.*$/gm, "");
  text = text.replace(/\|/g, " ");

  // Blockquote markers and list bullets.
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");

  // Collapse the whitespace all of the above tends to leave behind.
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{2,}/g, ". ");
  text = text.replace(/\n/g, " ");

  return text.trim();
}
