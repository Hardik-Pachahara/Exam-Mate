// Stage 3: send page TEXT to Gemini in a few small requests and get back short quotes to highlight.
// By default it uses ONLY your chosen model and reports a clear error if Gemini can't answer.
// Several API keys can be listed in GEMINI_API_KEYS; when one runs out of quota the next one is used.
// Optional (in .env): GEMINI_FALLBACK_MODELS=a,b to try other models; OFFLINE_FALLBACK=on for a simple offline highlighter.
import { CATEGORIES } from './tools.js';
import { localPassages } from './localHighlighter.js';
import { AppError, SOFT_KINDS, geminiError } from './errors.js';
import { getKeys } from './keys.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
const MODELS = [...new Set([MODEL, ...FALLBACKS])];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TRIES = 3;                         // attempts per model for short hiccups
const MAX_WAIT = 20;                     // never wait longer than this many seconds; report the error instead
const OVERLOAD_TRIES = Number(process.env.OVERLOAD_TRIES) || 2; // Google "busy" (503): total attempts per model, then stop
const OVERLOAD_PAUSE = 60;               // after that, send nothing to that model for this many seconds
const busyUntil = new Map();             // model -> time until which it is left alone
const BATCH_CHARS = Number(process.env.GEMINI_BATCH_CHARS) || 24000; // about 6k input tokens
const MAX_PER_PAGE = 20;

const SYSTEM = `You are helping a student make revision notes. For every page below, highlight ALL the information worth revising, so that someone reading only the highlights would still learn the whole page. Do not skip a topic because it seems minor.

WHAT TO HIGHLIGHT (use these categories for "c"):
- definition: what a term or concept means, including the term being defined.
- formula: formulas, equations, laws, rules, theorems, steps of a method or procedure, conditions and exceptions.
- fact: names of people, places, organisations and terms, dates and years, numbers, quantities, units, statistics and results.
- example: worked examples, case studies, illustrations and analogies the text gives.
- key_point: everything else that matters: explanations, reasons and causes, effects and consequences, comparisons and differences, classifications and lists of types, advantages and disadvantages, conclusions, warnings, tips and advice the text gives.

COVERAGE:
- Go through each page from the first line to the last and make sure every important idea, term, number and date on it is covered. Do not stop after the first few paragraphs.
- Use as many highlights as the page needs, up to ${MAX_PER_PAGE} per page. A page full of content should get many highlights; a page with little content may get only a few. Never return nothing for a page that has real content.
- Items in a list or bullet points should each be covered, not just the first one.

HOW TO WRITE EACH HIGHLIGHT ("t"):
- Copy it EXACTLY, word for word, from that page's text, as consecutive words with the same spelling, numbers and symbols. Never reword, shorten with "...", fix spelling or join text from two places.
- Make each highlight one single readable piece: a full sentence or a full clause that makes sense on its own, normally 5 to 25 words. Do not cut a sentence in the middle just to save space, and do not make several tiny pieces out of one idea.
- Include the key term together with its meaning, and a number together with what it measures.
- Do not repeat the same text, and do not let two highlights overlap.
- Skip headers, footers, page numbers, running titles, figure and table labels, and text that is only an instruction such as "see next page".
- "p" is the page number from the "=== PAGE n ===" line above the text. A highlight must come from a single page.
- No explanations or comments, only the highlights.`;

const schema = {
  type: 'OBJECT',
  properties: {
    passages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          p: { type: 'INTEGER' },
          t: { type: 'STRING' },
          c: { type: 'STRING', enum: Object.keys(CATEGORIES) }
        },
        required: ['p', 't', 'c']
      }
    }
  },
  required: ['passages']
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const noThink = new Set(); // models that rejected the thinking setting
const thinkingFor = m => noThink.has(m) ? null
  : /gemini-3/.test(m) ? { thinkingLevel: process.env.GEMINI_THINKING || 'low' } : { thinkingBudget: 0 };

function makeBatches(pages) {
  const out = [];
  let cur = [], size = 0;
  for (const p of pages) {
    const text = p.text.replace(/\s+/g, ' ').trim();
    if (text.split(' ').length < 8) continue;
    if (cur.length && size + text.length > BATCH_CHARS) { out.push(cur); cur = []; size = 0; }
    cur.push({ n: p.pageNumber, text });
    size += text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

function parse(raw) {
  try { return JSON.parse(raw).passages ?? []; } catch { }
  try { return JSON.parse(raw.slice(0, raw.lastIndexOf('}') + 1) + ']}').passages ?? []; } catch { return []; }
}

// The user's optional topic is added to the hardcoded prompt.
const systemFor = topic => topic
  ? `${SYSTEM}\nFOCUS: The student only wants highlights about this topic: "${topic}". Ignore everything on the page that is not about it. If a page has nothing about it, return nothing for that page.`
  : SYSTEM;

// ---- API key rotation ----
// A key that hits a quota/rate/auth error is put on a cooldown and the next key is used straight away.
const cooling = new Map(); // "key" or "model|key" -> { until: ms timestamp, err }
const KEY_KINDS = new Set(['daily', 'rate', 'tokens', 'key', 'denied']);

const coolEntry = (k, model) => [cooling.get(k), cooling.get(`${model}|${k}`)].filter(Boolean).sort((a, b) => b.until - a.until)[0];

function pickKey(keys, model) {
  const now = Date.now();
  const entries = keys.map(k => ({ k, e: coolEntry(k, model) }));
  const ready = entries.find(x => !x.e || x.e.until <= now);
  if (ready) return { key: ready.k };
  const soon = entries.sort((a, b) => a.e.until - b.e.until)[0].e;
  return { waitSecs: Math.ceil((soon.until - now) / 1000), err: soon.err };
}

function coolDown(key, model, err) {
  const secs = err.kind === 'key' ? 86400 : err.kind === 'daily' ? 3600 : err.kind === 'denied' ? 3600 : (err.retrySecs || 60) + 1;
  // an invalid key is bad for every model; quota errors only count for the model that hit them
  cooling.set(err.kind === 'key' ? key : `${model}|${key}`, { until: Date.now() + secs * 1000, err });
}

async function callGemini(system, prompt) {
  const keys = getKeys();
  if (!keys.length) throw new AppError('No Gemini API key found. Add GEMINI_API_KEYS to your .env file.', { kind: 'key' });
  let lastErr;
  for (const model of MODELS) {
    if ((busyUntil.get(model) ?? 0) > Date.now()) {                    // it was overloaded a moment ago: don't send more
      lastErr ??= geminiError(503, '', model);
      console.log(`  -> ${model} was overloaded a moment ago, not sending anything to it yet`);
      continue;
    }
    let attempt = 0;
    while (attempt < TRIES) {
      const pick = pickKey(keys, model);
      if (!pick.key) {                                                 // every key is cooling down
        lastErr ??= pick.err;
        if (pick.waitSecs > MAX_WAIT) break;                           // too long to wait: report it
        attempt++;
        console.log(`  -> all keys are busy, waiting ${pick.waitSecs}s, then retrying`);
        await sleep(pick.waitSecs * 1000);
        continue;
      }
      const keyNo = keys.indexOf(pick.key) + 1;
      const thinking = thinkingFor(model);
      let res;
      try {
        res = await fetch(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': pick.key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2,
              maxOutputTokens: 4096, ...(thinking && { thinkingConfig: thinking })
            }
          })
        });
      } catch (e) {
        throw new AppError('Could not reach Gemini. Check your internet connection and try again.', { kind: 'network', detail: e.message });
      }

      if (res.ok) {
        const data = await res.json();
        const cand = data.candidates?.[0];
        const raw = cand?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
        if (!raw) {
          lastErr = new AppError(`Gemini returned no answer (${cand?.finishReason ?? 'blocked'}). Try again.`, { kind: 'empty', detail: `${model}: empty response` });
          break;
        }
        console.log(`Gemini (${model}, key ${keyNo}/${keys.length}) tokens: ${JSON.stringify(data.usageMetadata ?? {})}`);
        return parse(raw);
      }

      const body = await res.text();
      if (res.status === 400 && thinking && /think/i.test(body)) { noThink.add(model); continue; } // model can't use that setting
      const err = geminiError(res.status, body, model);
      console.log(`key ${keyNo}/${keys.length}: ${err.detail}`);
      lastErr = err;
      if (KEY_KINDS.has(err.kind)) {                                   // this key is out of quota or rejected: try the next one
        coolDown(pick.key, model, err);
        console.log(keys.length > 1 ? '  -> switching to the next API key' : '  -> no other API key to switch to');
        continue;
      }
      if (!SOFT_KINDS.has(err.kind)) throw err;                        // bad request etc.: stop now
      if (err.kind === 'model') break;                                 // waiting won't help this model
      attempt++;
      if (err.kind === 'overload' && attempt >= OVERLOAD_TRIES) {      // Google is busy: stop hammering it
        busyUntil.set(model, Date.now() + OVERLOAD_PAUSE * 1000);
        break;
      }
      if (attempt < TRIES) {
        const wait = (err.kind === 'overload' ? 10 : 5) * attempt;     // short, growing pause
        if (wait > MAX_WAIT) break;
        console.log(`  -> waiting ${wait}s, then retrying`);
        await sleep(wait * 1000);
      }
    }
  }
  throw lastErr ?? new AppError('Gemini did not answer. Try again.', { kind: 'other' });
}

// Returns Map(pageNumber -> [{ text, category }]); map.fallback is true only if the offline highlighter was used.
// topic (optional): only highlight text about this subject.
export async function analyzePages(pages, topic = '') {
  const result = new Map(pages.map(p => [p.pageNumber, []]));
  result.fallback = false;
  const system = systemFor(topic);
  const groups = makeBatches(pages);
  for (let i = 0; i < groups.length; i++) {
    const prompt = groups[i].map(g => `=== PAGE ${g.n} ===\n${g.text}`).join('\n\n');
    let list;
    try { list = await callGemini(system, prompt); }
    catch (e) {
      // the offline highlighter cannot follow a topic, so it is not used when one is set
      if (process.env.OFFLINE_FALLBACK !== 'on' || topic || !SOFT_KINDS.has(e.kind)) throw e;
      console.warn(`${e.detail || e.message}\nUsing the offline highlighter for these pages (OFFLINE_FALLBACK=on).`);
      result.fallback = true;
      list = localPassages(groups[i]);
    }
    for (const x of list) {
      const arr = result.get(x.p);
      if (arr && x.t && arr.length < MAX_PER_PAGE) arr.push({ text: x.t, category: x.c in CATEGORIES ? x.c : 'key_point' });
    }
    if (i < groups.length - 1) await sleep(3000);
  }
  console.log(`Gemini: ${groups.length} request group(s) for ${pages.length} pages${topic ? ` (topic: ${topic})` : ''}${result.fallback ? ' (offline fallback used)' : ''}`);
  return result;
}