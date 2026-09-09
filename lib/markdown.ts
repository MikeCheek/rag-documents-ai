// The model sometimes writes LaTeX-native math delimiters (\( \), \[ \])
// instead of the $ / $$ syntax remark-math expects out of the box. Left
// alone, plain CommonMark mangles that raw LaTeX badly: it silently strips
// backslashes before punctuation (\( -> (, \; -> ;) as if they were
// ordinary escape sequences, and underscore-based subscripts (_{3}) get
// partially eaten by markdown's emphasis parsing. Converting to $ / $$
// before the markdown pipeline runs means remark-math/rehype-katex own
// that span instead of plain CommonMark ever touching it.
export function normalizeMathDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr: string) => `$$${expr}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expr: string) => `$${expr}$`);
}
