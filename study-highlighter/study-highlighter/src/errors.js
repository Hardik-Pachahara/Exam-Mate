// Turns low-level failures into short messages that are shown on the web page.
// The full technical detail goes to the terminal only.
export class AppError extends Error {
  constructor(message, { status = 500, kind = 'other', detail = '', retrySecs = 0 } = {}) {
    super(message);
    Object.assign(this, { status, kind, detail, retrySecs });
  }
}

// Problems that may clear up by waiting or trying another model.
export const SOFT_KINDS = new Set(['daily', 'rate', 'tokens', 'overload', 'model', 'empty']);

export function geminiError(status, body, model) {
  let msg = body.slice(0, 300), retrySecs = 0;
  try {
    const e = JSON.parse(body).error;
    msg = e.message ?? msg;
    retrySecs = parseInt((e.details ?? []).find(d => d.retryDelay)?.retryDelay) || 0; // e.g. "34s"
  } catch {}
  const detail = `${model} -> HTTP ${status}: ${msg}`;
  const wait = retrySecs ? ` Try again in about ${retrySecs} seconds.` : ' Wait a minute and try again.';
  const make = (kind, text) => new AppError(text, { status, kind, detail, retrySecs });

  if (status === 429 && /PerDay|per day|daily/i.test(body)) return make('daily', `Daily limit reached for ${model} on every API key. Add another key to GEMINI_API_KEYS, try again tomorrow, or switch model.`);
  if (status === 429 && /token/i.test(body)) return make('tokens', `Token limit reached for this minute.${wait}`);
  if (status === 429) return make('rate', `Request rate limit reached.${wait}`);
  if (status >= 500) return make('overload', 'Gemini is overloaded right now (high demand). Try again in a few minutes.');
  if (status === 401) return make('key', 'Gemini rejected an API key. Check GEMINI_API_KEYS in your .env file.');
  if (status === 403) return make('denied', 'Gemini denied access for this key or model. Check the key\'s permissions.');
  if (status === 404) return make('model', `Model "${model}" was not found. Change GEMINI_MODEL in your .env file.`);
  if (status === 400) return make('request', 'Gemini rejected the request. Details are in the terminal.');
  return make('other', `Gemini returned an error (HTTP ${status}). Details are in the terminal.`);
}

// What the web page is allowed to show for ANY error.
export function friendly(e) {
  if (e instanceof AppError) return e.message;
  if (/invalid pdf|pdf header|InvalidPDF/i.test(`${e?.name} ${e?.message}`)) return 'This file could not be read as a PDF.';
  return 'Something went wrong while processing the PDF. Details are in the terminal.';
}