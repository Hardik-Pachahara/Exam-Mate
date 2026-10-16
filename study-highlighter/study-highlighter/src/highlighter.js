// Stage 5: draw translucent, multiply-blended highlights on the ORIGINAL pdf pages.
import { PDFDocument, rgb, BlendMode } from 'pdf-lib';
import { CATEGORIES } from './tools.js';

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export async function highlightPdf(buffer, pages) {
  const pdf = await PDFDocument.load(buffer);
  for (const pg of pages) {
    if (pg.rotate % 360) { console.warn(`Page ${pg.pageNumber} is rotated, skipping highlights`); continue; }
    const page = pdf.getPage(pg.pageNumber - 1);
    const [vx0, , vx1, vy1] = pg.view; // visible area of the page in PDF units
    const vy0 = pg.view[1];
    const sx = (vx1 - vx0) / pg.width, sy = (vy1 - vy0) / pg.height;
    for (const r of pg.rects) {
      const [R, G, B] = hex(CATEGORIES[r.category].color);
      page.drawRectangle({
        x: vx0 + r.x0 * sx, y: vy1 - r.y1 * sy,
        width: (r.x1 - r.x0) * sx, height: (r.y1 - r.y0) * sy,
        color: rgb(R, G, B), opacity: 0.4, blendMode: BlendMode.Multiply
      });
    }
  }
  return Buffer.from(await pdf.save());
}