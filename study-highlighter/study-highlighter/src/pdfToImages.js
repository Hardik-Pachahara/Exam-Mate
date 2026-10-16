// Stage 1b: render pages to PNG (only needed for scanned pages that have no text layer).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// pageNumbers: optional list of pages to render (null = every page).
export async function pdfToImages(buffer, pageNumbers = null, scale = 2) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];
  for (const i of pageNumbers ?? Array.from({ length: doc.numPages }, (_, k) => k + 1)) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const { canvas, context } = doc.canvasFactory.create(vp.width, vp.height);
    await page.render({ canvasContext: context, viewport: vp }).promise;
    pages.push({
      pageNumber: i, width: vp.width, height: vp.height, view: page.view, rotate: page.rotate,
      png: canvas.toBuffer('image/png')
    });
  }
  return pages;
}