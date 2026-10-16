// Stage 4: find each quoted passage inside the OCR text and return the matching word range.
// Works on letters only (no spaces/punctuation), so OCR splitting or merging words doesn't break it.
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const bigrams = s => {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); }
  return m;
};
// Dice similarity (0 to 1) between two strings, used when the exact quote isn't found.
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  const total = Math.max(a.length - 1, 0) + Math.max(b.length - 1, 0);
  return total ? (2 * inter) / total : 0;
}

export function matchPassages(words, passages) {
  const nw = words.map(w => norm(w.text));
  let text = '';
  const owner = []; // owner[charIndex] = index of the word that letter came from
  nw.forEach((n, i) => { text += n; for (let k = 0; k < n.length; k++) owner.push(i); });

  const matches = [];
  for (const p of passages) {
    const q = norm(p.text || '');
    if (q.length < 8) continue;
    let start = -1, end = -1;

    const at = text.indexOf(q); // 1) exact match on letters
    if (at >= 0) { start = owner[at]; end = owner[at + q.length - 1]; }
    else {                      // 2) fuzzy: slide a window of the same length over the words
      let best = 0;
      for (let i = 0; i < nw.length; i++) {
        let s = '', j = i;
        while (j < nw.length && s.length < q.length) s += nw[j++];
        const d = dice(q, s);
        if (d > best) { best = d; start = i; end = j - 1; }
      }
      if (best < 0.75) start = -1;
    }
    if (start >= 0) matches.push({ ...p, start, end });
  }
  return matches;
}

// One rectangle per text line, so highlights look like a real marker stroke.
export function toLineRects(words, matches) {
  const rects = [];
  for (const m of matches) {
    let cur = null;
    for (const wd of words.slice(m.start, m.end + 1)) {
      const sameLine = cur && Math.abs(wd.y0 - cur.y0) < (cur.y1 - cur.y0) * 0.6;
      if (sameLine) {
        cur.x1 = Math.max(cur.x1, wd.x1); cur.y0 = Math.min(cur.y0, wd.y0); cur.y1 = Math.max(cur.y1, wd.y1);
      } else {
        if (cur) rects.push(cur);
        cur = { x0: wd.x0, y0: wd.y0, x1: wd.x1, y1: wd.y1, category: m.category };
      }
    }
    if (cur) rects.push(cur);
  }
  return rects;
}