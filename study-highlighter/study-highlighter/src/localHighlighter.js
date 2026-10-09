// Offline fallback used only when Gemini is unavailable: picks sentences with simple scoring rules.
// Quality is lower than the AI, but it always works and costs nothing.
const CUES = [
  ['definition', /\b(is defined as|are defined as|refers? to|is called|are called|is known as|means|can be defined)\b/i],
  ['formula',    /(=|\bformula\b|\bequation\b|\btheorem\b|\blaw of\b|\bprinciple\b|\brule\b)/i],
  ['fact',       /\b(1[0-9]{3}|20[0-9]{2})\b|\b\d+(\.\d+)?\s?(%|percent|kg|km|cm|mm|years?)\b/i],
  ['key_point',  /\b(important|key|main|primary|essential|must|always|never|therefore|objective|significant|helps?)\b/i]
];
const STOP = new Set('the and for with that this from are was were have has been which can also their there into when than then them these those'.split(' '));

export function localPassages(group, perPage = 6) {
  const out = [];
  for (const { n, text } of group) {
    const sentences = (text.match(/[^.!?]+[.!?]?/g) ?? []).map(s => s.trim()).filter(s => s.split(' ').length >= 6);
    const freq = new Map();
    for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);

    const scored = sentences.map(s => {
      const words = s.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      let score = words.reduce((a, w) => a + (freq.get(w) || 0), 0) / Math.sqrt(words.length || 1);
      let cat = null;
      for (const [c, re] of CUES) if (re.test(s)) { score += 6; cat ??= c; }
      return { s, score, cat: cat ?? 'key_point' };
    });
    scored.sort((a, b) => b.score - a.score);
    for (const x of scored.slice(0, Math.min(perPage, Math.ceil(sentences.length * 0.25)))) {
      out.push({ p: n, t: x.s.split(' ').slice(0, 25).join(' '), c: x.cat });
    }
  }
  return out;
}
