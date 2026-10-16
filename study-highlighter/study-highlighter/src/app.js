// The whole web app (routes), shared by `npm start` on your computer (server.js) and Vercel (api/index.js).
import './loadEnv.js';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { runPipeline } from './pipeline.js';
import { countPages } from './textLayer.js';
import { CATEGORIES } from './tools.js';
import { friendly, AppError } from './errors.js';
import { initDb } from './db.js';
import authRouter, { requireUser, sameOrigin, clientIp } from './authRoutes.js';
import { reserveRun } from './usage.js';
import * as blob from './blobStore.js';

const USE_BLOB = blob.enabled;

// Tables are created once per server instance, on the first request that needs the database.
let dbReady;
export const ensureDb = () => (dbReady ??= initDb().catch(e => { dbReady = undefined; throw e; }));

const app = express();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });
app.use(express.json());
app.use(sameOrigin);                       // blocks POSTs started from other websites
app.use(express.static('public'));         // locally only; on Vercel the public folder is served directly
app.use('/api', async (req, res, next) => {
  try { await ensureDb(); next(); }
  catch (e) { console.error('Database:', e.message); res.status(503).json({ error: 'The database is not reachable. Try again in a moment.' }); }
});
app.use('/api', authRouter);               // sign up, log in, admin dashboard
app.get('/api/categories', (_, res) => res.json(CATEGORIES));

// Tells the page how to upload: straight to Blob (Vercel) or through this server (your computer).
app.get('/api/upload-config', requireUser, (req, res) => res.json({ blob: USE_BLOB, userId: req.user.id }));
app.post('/api/blob-upload', blob.uploadRoute);

// Daily clean-up of old uploads and results. Vercel's cron calls it with the CRON_SECRET.
app.get('/api/cleanup', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!USE_BLOB || !secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).end();
  try { res.json(await blob.cleanup()); }
  catch (e) { console.error('cleanup:', e.message); res.status(500).json({ error: 'cleanup failed' }); }
});

// Local only: highlighted PDFs, each file starts with its owner's id, and only the owner (or the admin) can open it.
app.get('/outputs/:file', requireUser, (req, res) => {
  const f = req.params.file;
  if (!/^[\w-]+\.pdf$/.test(f) || (req.user.role !== 'admin' && !f.startsWith(`${req.user.id}-`))) return res.status(404).end();
  res.sendFile(f, { root: path.resolve('outputs') });
});

const fail = (res, e) => {
  console.error(e.detail || e);                                                                   // full detail stays in the logs
  res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: friendly(e) });   // short message goes to the page
};

// Shared wrapper: gets the PDF (as req.pdf), runs `handler(req)` and sends back its result as JSON.
// The PDF arrives either as a normal upload (your computer) or as a Blob path (Vercel).
const route = handler => (req, res) => {
  const finish = async () => { try { res.json(await handler(req)); } catch (e) { fail(res, e); } };
  if (req.is('multipart/form-data')) {
    upload.single('pdf')(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (50 MB max).' : 'Upload failed. Try again.' });
      if (!req.file) return res.status(400).json({ error: 'Attach a PDF file.' });
      req.pdf = req.file.buffer;
      finish();
    });
  } else if (USE_BLOB && req.is('application/json')) {
    blob.loadInput(req.body?.blobPath, req.user)
      .then(buf => { req.pdf = buf; req.blobPath = req.body.blobPath; return finish(); })
      .catch(e => fail(res, e));
  } else {
    res.status(400).json({ error: 'Attach a PDF file.' });
  }
};

// Step 1: how many pages does this PDF have? (fills the page dropdown). Free: it does not use an attempt.
app.post('/api/pages', requireUser, route(async req => ({ pageCount: await countPages(req.pdf) })));

// Step 2: highlight. Fields: pages ("1,3,5", empty = all) and topic (free text).
app.post('/api/highlight', requireUser, route(async req => {
  const slot = await reserveRun(req.user, clientIp(req));
  if (!slot.ok) throw new AppError(slot.message, { status: 429, kind: 'limit' });
  try {
    const result = await runPipeline(req.pdf, `${req.user.id}-${randomUUID()}`, {
      pages: req.body.pages, topic: req.body.topic,
      save: USE_BLOB ? (id, bytes) => blob.saveOutput(req.user.id, id, bytes) : undefined
    });
    if (req.blobPath) await blob.removeInput(req.blobPath);   // the upload is not needed any more
    return result;
  } catch (e) {
    await slot.refund();                                      // a failed run doesn't use up an attempt
    throw e;
  }
}));

export default app;
