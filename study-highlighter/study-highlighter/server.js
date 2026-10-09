import './src/loadEnv.js';
import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { runPipeline } from './src/pipeline.js';
import { countPages } from './src/textLayer.js';
import { CATEGORIES } from './src/tools.js';
import { friendly } from './src/errors.js';
import { getKeys } from './src/keys.js';

const keyCount = getKeys().length;
if (!keyCount) { console.error('Set GEMINI_API_KEYS (key1,key2,...) in your .env file first.'); process.exit(1); }
console.log(`Loaded ${keyCount} Gemini API key${keyCount > 1 ? 's' : ''}.`);

const app = express();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });
app.use(express.static('public'));
app.use('/outputs', express.static('outputs'));
app.get('/api/categories', (_, res) => res.json(CATEGORIES));

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

// Step 1: how many pages does this PDF have? (fills the page dropdown)
app.post('/api/pages', route(async req => ({ pageCount: await countPages(req.file.buffer) })));

// Step 2: highlight. Optional form fields: pages ("1,3,5", empty = all) and topic (free text).
app.post('/api/highlight', route(req =>
  runPipeline(req.file.buffer, randomUUID(), { pages: req.body.pages, topic: req.body.topic })
));

app.listen(3000, () => console.log('Open http://localhost:3000'));