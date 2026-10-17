// Runs the app on your own computer: `npm start`. (On Vercel, api/index.js is used instead.)
import './src/loadEnv.js';
import app, { ensureDb } from './src/app.js';
import { getKeys } from './src/keys.js';

const keyCount = getKeys().length;
if (!keyCount) { console.error('Set GEMINI_API_KEYS (key1,key2,...) in your .env file first.'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL (your Neon connection string) in your .env file first.'); process.exit(1); }
console.log(`Loaded ${keyCount} Gemini API key${keyCount > 1 ? 's' : ''}.`);

try { await ensureDb(); }
catch (e) { console.error('Could not connect to the database. Check DATABASE_URL in your .env file.\n' + e.message); process.exit(1); }

app.listen(3000, () => console.log('Open http://localhost:3000'));