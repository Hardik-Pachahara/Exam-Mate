import './src/loadEnv.js';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { runPipeline } from './src/pipeline.js';
import { countPages } from './src/textLayer.js';
import { CATEGORIES } from './src/tools.js';
import { friendly, AppError } from './src/errors.js';
import { getKeys } from './src/keys.js';
import { initDb } from './src/db.js';
import authRouter, { requireUser, sameOrigin, clientIp } from './src/authRoutes.js';
import { reserveRun } from './src/usage.js';

const ON_VERCEL = !!process.env.VERCEL;
const OUT_DIR = ON_VERCEL ? '/tmp/outputs' : 'outputs';   // Vercel's disk is read-only except /tmp

const keyCount = getKeys().length;
if (!keyCount) { console.error('Set GEMINI_API_KEYS (key1,key2,...) in your .env file (or in Vercel settings) first.'); if (!ON_VERCEL) process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL (your Neon connection string) in your .env file (or in Vercel settings) first.'); if (!ON_VERCEL) process.exit(1); }
console.log(`Loaded ${keyCount} Gemini API key${keyCount > 1 ? 's' : ''}.`);

const app = express();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });
app.use(express.json());
app.use(sameOrigin);                       // blocks POSTs started from other websites

// Connects to the database once, on the first request (Vercel has no "startup" step to do this in).
let dbReady = null;
const ensureDb = () => (dbReady ??= initDb().catch(e => { dbReady = null; throw e; }));
app.use('/api', async (req, res, next) => {
  try { await ensureDb(); next(); }
  catch (e) { console.error(e.message); res.status(503).json({ error: 'The database is not reachable. Try again in a moment.' }); }
});
app.use(express.static('public'));
app.use('/api', authRouter);               // sign up, log in, admin dashboard
app.get('/api/categories', (_, res) => res.json(CATEGORIES));

// Highlighted PDFs: each file starts with its owner's id, and only the owner (or the admin) can open it.
app.get('/outputs/:file', requireUser, (req, res) => {
  const f = req.params.file;
  if (!/^[\w-]+\.pdf$/.test(f) || (req.user.role !== 'admin' && !f.startsWith(`${req.user.id}-`))) return res.status(404).end();
  res.sendFile(f, { root: path.resolve(OUT_DIR) });
});

// Shared wrapper: handles the upload, then runs `handler(req)` and sends back its result as JSON.
const route = handler => (req, res) => {
  upload.single('pdf')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (50 MB max).' : 'Upload failed. Try again.' });
    if (!req.file) return res.status(400).json({ error: 'Attach a PDF file.' });
    try {
      res.json(await handler(req));
    } catch (e) {
      console.error(e.detail || e);                       // full detail stays in the terminal
      res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: friendly(e) }); // short message goes to the page
    }
  });
};

// Step 1: how many pages does this PDF have? (fills the page dropdown). Free: it does not use an attempt.
app.post('/api/pages', requireUser, route(async req => ({ pageCount: await countPages(req.file.buffer) })));

// Step 2: highlight. Optional form fields: pages ("1,3,5", empty = all) and topic (free text).
app.post('/api/highlight', requireUser, route(async req => {
  const slot = await reserveRun(req.user, clientIp(req));
  if (!slot.ok) throw new AppError(slot.message, { status: 429, kind: 'limit' });
  try {
    return await runPipeline(req.file.buffer, `${req.user.id}-${randomUUID()}`, { pages: req.body.pages, topic: req.body.topic, outDir: OUT_DIR });
  } catch (e) {
    await slot.refund();                                  // a failed run doesn't use up an attempt
    throw e;
  }
}));

// On your computer: start the server. On Vercel: just export the app (Vercel runs it per request).
if (!ON_VERCEL) {
  try { await ensureDb(); }
  catch (e) { console.error('Could not connect to the database. Check DATABASE_URL in your .env file.\n' + e.message); process.exit(1); }
  app.listen(3000, () => console.log('Open http://localhost:3000'));
}

export default app;