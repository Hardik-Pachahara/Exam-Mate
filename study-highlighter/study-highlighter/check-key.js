// Run with: node check-key.js   (diagnoses the .env file and tests EVERY Gemini key)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
console.log('Project folder:', root);
console.log('Env-like files in it:', fs.readdirSync(root).filter(f => /^\.?env/i.test(f)));

await import('./src/loadEnv.js'); // same .env loading as the server
const { getKeys } = await import('./src/keys.js');

for (const name of ['.env', '.env.txt']) {
  const f = path.join(root, name);
  if (!fs.existsSync(f)) continue;
  const buf = fs.readFileSync(f);
  const text = (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')).replace(/^\uFEFF/, '');
  const names = text.split(/\r?\n/).map(l => l.match(/^\s*([\w.]+)\s*=(.*)$/)).filter(Boolean).map(m => `${m[1]} (${m[2].trim().length} chars)`);
  console.log(`${name}: ${buf.length} bytes, variables found: ${names.length ? names.join(', ') : 'NONE'}`);
}

const keys = getKeys();
const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash'; // same default as src/analyzer.js
console.log(`\nModel setting: ${model}`);
console.log(`API keys found: ${keys.length}`);
if (!keys.length) { console.log('No key loaded. Add GEMINI_API_KEYS=key1,key2 to the .env file.'); process.exit(1); }

const base = 'https://generativelanguage.googleapis.com/v1beta/models';
let working = 0;
for (const [i, key] of keys.entries()) {
  const label = `Key ${i + 1}/${keys.length} (${key.slice(0, 4)}...${key.slice(-3)}, ${key.length} chars)`;
  try {
    const r = await fetch(`${base}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }] })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { working++; console.log(`${label}: WORKS. Model replied: ${d.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').slice(0, 20).trim()}`); }
    else console.log(`${label}: HTTP ${r.status} ${d.error?.status ?? ''} | ${String(d.error?.message ?? '').slice(0, 140)}`);
  } catch (e) { console.log(`${label}: network error: ${e.message}`); }
}
console.log(`\n${working} of ${keys.length} key(s) working.`);