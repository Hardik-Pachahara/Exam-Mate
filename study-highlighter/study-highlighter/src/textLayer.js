// Stage 1a: read words and their positions directly from a digital PDF's text layer.
// Exact and instant. Pages with (almost) no text are scans and fall back to OCR.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// pageNumbers: optional list like [2, 5]; pages not in it are skipped entirely (null = every page).
export async function extractTextLayer(buffer, pageNumbers = null, scale = 2) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];
  for (const i of pageNumbers ?? Array.from({ length: doc.numPages }, (_, k) => k + 1)) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const content = await page.getTextContent();
    const words = [];
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const t = pdfjs.Util.transform(vp.transform, item.transform);
      const h = Math.hypot(t[2], t[3]);      // font height in pixels
      const w = item.width * scale;          // item width in pixels
      for (const m of item.str.matchAll(/\S+/g)) {
        words.push({
          text: m[0],
          x0: t[4] + (w * m.index) / item.str.length,
          x1: t[4] + (w * (m.index + m[0].length)) / item.str.length,
          y0: t[5] - h * 0.8,
          y1: t[5] + h * 0.25
        });
      }
    }
    pages.push({
      pageNumber: i, width: vp.width, height: vp.height, view: page.view, rotate: page.rotate,
      words, text: words.map(x => x.text).join(' ')
    });
  }
  return pages;
}

// Page count only (fast: nothing is rendered or read). Used to fill the page dropdown.
export async function countPages(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}