// Assigns each document a maximally-distinct, stable color using golden-angle
// hue stepping (the angle that avoids any two nearby indices landing on
// similar hues, however many documents there are) rather than hashing into a
// small fixed palette, which collides once there are more documents than
// palette entries. Ordering documents by creation time (not the order they
// happen to appear in a given search's results) means a document keeps the
// same color across different Constellation searches.

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) =>
    light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

const GOLDEN_ANGLE = 137.50776405;

export function buildDocumentColorMap(
  documentIds: string[]
): Map<string, string> {
  const map = new Map<string, string>();
  documentIds.forEach((id, index) => {
    const hue = (index * GOLDEN_ANGLE) % 360;
    map.set(id, hslToHex(hue, 68, 60));
  });
  return map;
}

export const FALLBACK_DOCUMENT_COLOR = "#8B92A3";
