// Stage 2: OCR. Gives every word a bounding box (in image pixels) so highlights can be placed exactly.
import { createWorker } from 'tesseract.js';

export async function ocrPages(pages, lang = 'eng') {
  const worker = await createWorker(lang);
  try {
    const out = [];
    for (const p of pages) {
      const { data } = await worker.recognize(p.png);
      const words = data.words
        .filter(w => w.text.trim() && w.confidence > 30)
        .map(w => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }));
      out.push({ ...p, words, text: words.map(w => w.text).join(' ') });
    }
    return out;
  } finally {
    await worker.terminate();
  }
}
