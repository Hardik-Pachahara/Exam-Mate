// Stage 2: OCR. Gives every word a bounding box (in image pixels) so highlights can be placed exactly.
import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { flattenLighting } from './flatten.js';

// Optional: OCR_CLEANUP=off in .env switches the lighting clean-up off.
async function cleanUp(png) {
  if (process.env.OCR_CLEANUP === 'off') return png;
  try {
    const img = await loadImage(png);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    if (!flattenLighting(data.data, img.width, img.height)) return png;
    ctx.putImageData(data, 0, 0);
    return canvas.toBuffer('image/png');
  } catch (e) {
    console.warn(`Image clean-up skipped: ${e.message}`);
    return png;
  }
}

// Use the language file that sits next to package.json (eng.traineddata). It is also bundled into the Vercel
// function, where the disk is read-only and nothing can be downloaded and saved.
function workerOptions(lang) {
  const local = fs.existsSync(path.join(process.cwd(), `${lang}.traineddata`));
  return local ? { langPath: process.cwd(), gzip: false, cacheMethod: 'none' } : {};
}

export async function ocrPages(pages, lang = 'eng') {
  const worker = await createWorker(lang, 1, workerOptions(lang));
  try {
    // 3 = automatic page layout: reads columns one after another instead of line by line across both
    await worker.setParameters({ tessedit_pageseg_mode: '3' });
    const out = [];
    for (const p of pages) {
      const { data } = await worker.recognize(await cleanUp(p.png));
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