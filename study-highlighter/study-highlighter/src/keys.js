// Reads every Gemini API key from the environment, in order.
//   GEMINI_API_KEYS=key1,key2,key3   (comma separated, tried in this order)
//   GEMINI_API_KEY=key               (the old single-key variable still works)
export function getKeys() {
  const raw = [process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY].filter(Boolean).join(',');
  const keys = raw.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  return [...new Set(keys)];
}
