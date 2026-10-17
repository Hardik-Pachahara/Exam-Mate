// Orchestrates the stages: text layer (or OCR for scans) -> AI -> match -> highlight -> save.
// Only the pages the user selected are read, OCR'd and sent to the AI.
import fs from 'fs/promises';
import { extractTextLayer, countPages } from './textLayer.js';
import { pdfToImages } from './pdfToImages.js';
import { ocrPages } from './ocrTool.js';
import { analyzePages } from './analyzer.js';
import { matchPassages, toLineRects } from './matcher.js';
import { highlightPdf } from './highlighter.js';
import { AppError } from './errors.js';

// Limits that only apply on Vercel by default (0 = no limit). Change them with MAX_PAGES / MAX_OCR_PAGES in the environment.
const MAX_PAGES = Number(process.env.MAX_PAGES ?? (process.env.VERCEL ? 80 : 0)) || 0;
const MAX_OCR_PAGES = Number(process.env.MAX_OCR_PAGES ?? (process.env.VERCEL ? 15 : 0)) || 0;

// Local default: write the finished PDF into the outputs folder and return its address.
async function saveLocal(id, bytes) {
  await fs.mkdir('outputs', { recursive: true });
  await fs.writeFile(`outputs/${id}.pdf`, bytes);
  return `/outputs/${id}.pdf`;
}

// "1,3,5" -> [1, 3, 5]. Empty or missing means every page. Invalid numbers are dropped.
function selectPages(spec, total) {
  if (spec == null || String(spec).trim() === '') return Array.from({ length: total }, (_, i) => i + 1);
  const nums = String(spec).split(',').map(s => parseInt(s, 10));
  return [...new Set(nums)].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
}

export async function runPipeline(buffer, id, { pages: pageSpec, topic = '', save } = {}) {
  topic = String(topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const total = await countPages(buffer);
  const selected = selectPages(pageSpec, total);
  if (!selected.length) throw new AppError('Pick at least one page that exists in this PDF.', { status: 400, kind: 'request' });
  // On Vercel a run must finish within the function's time limit, so very long runs are refused politely.
  if (MAX_PAGES && selected.length > MAX_PAGES) {
    throw new AppError(`Too many pages at once (${selected.length}). Select up to ${MAX_PAGES} pages and run it again.`, { status: 400, kind: 'request' });
  }

  const layer = await extractTextLayer(buffer, selected);
  const scans = layer.filter(p => p.words.length < 20); // no real text layer: needs OCR
  if (MAX_OCR_PAGES && scans.length > MAX_OCR_PAGES) {
    throw new AppError(`Scanned pages are slow to read. Select up to ${MAX_OCR_PAGES} scanned pages at a time (you selected ${scans.length}).`, { status: 400, kind: 'request' });
  }
  if (scans.length) {
    const images = await pdfToImages(buffer, scans.map(s => s.pageNumber));
    for (const o of await ocrPages(images)) {
      layer[layer.findIndex(p => p.pageNumber === o.pageNumber)] = { ...o, ocr: true };
    }
  }
  if (!layer.some(p => p.words.length >= 8)) {
    throw new AppError('No readable text found on the selected pages. Try other pages or a clearer scan.', { status: 422, kind: 'notext' });
  }

  const ai = await analyzePages(layer, topic); // one batched call for several pages
  const pages = [];
  for (const p of layer) {
    const passages = ai.get(p.pageNumber) ?? [];
    const matches = matchPassages(p.words, passages);
    const rects = toLineRects(p.words, matches);
    console.log(`Page ${p.pageNumber} (${p.ocr ? 'OCR' : 'text layer'}): ${p.words.length} words, ${passages.length} passages from AI, ${matches.length} matched, ${rects.length} highlight boxes`);
    pages.push({
      pageNumber: p.pageNumber, width: p.width, height: p.height, view: p.view, rotate: p.rotate, topic: '', rects,
      passages: matches.map(({ text, category, reason }) => ({ text, category, reason }))
    });
  }

  const placed = pages.reduce((n, p) => n + p.passages.length, 0);
  let notice = '';
  if (ai.fallback) notice = 'Gemini was unavailable, so these highlights came from a simpler offline method.';
  else if (!placed) notice = topic
    ? `Nothing about "${topic}" could be highlighted on the selected pages. Try different wording or other pages.`
    : 'No highlights could be placed on this PDF. Try again or use a clearer file.';

  const pdfUrl = await (save ?? saveLocal)(id, await highlightPdf(buffer, pages)); // `save` is given on Vercel (stores it in Blob)
  return { pdfUrl, pages: pages.map(({ rects, view, rotate, ...rest }) => rest), notice };
}