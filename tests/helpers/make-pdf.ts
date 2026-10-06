// Builds a minimal valid PDF in memory: one page per entry, each line drawn
// as text (or no text at all, to imitate a scanned page).
export function makePdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1: catalog, 2: pages, 3: font; pages and their content streams follow.
  let nextId = 4;
  const pageObjects: [number, string][] = [];
  for (const lines of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageIds.push(pageId);
    const ops = lines
      .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`)
      .join("\n");
    pageObjects.push([
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    ]);
    pageObjects.push([contentId, `<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`]);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (const [id, body] of pageObjects) objects[id] = body;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Builds an image-only PDF (like a scan): one JPEG per page, no text layer. */
export function makeImagePdf(pages: { jpeg: Buffer; width: number; height: number }[]): Buffer {
  const parts: (string | Buffer)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Buffer) => {
    parts.push(chunk);
    length += typeof chunk === "string" ? Buffer.byteLength(chunk, "latin1") : chunk.length;
  };
  const obj = (id: number, body: (string | Buffer)[]) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body.forEach(push);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n");
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`]);
  pages.forEach((page, i) => {
    const [pageId, contentId, imageId] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    const ops = "q 612 0 0 792 0 0 cm /Im0 Do Q";
    obj(pageId, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ]);
    obj(contentId, [`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`]);
    obj(imageId, [
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      "\nendstream",
    ]);
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p)));
}
