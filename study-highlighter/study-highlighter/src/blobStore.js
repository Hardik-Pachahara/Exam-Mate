// Vercel Blob (private store): where uploaded PDFs and finished PDFs live on Vercel.
// It is switched on only when BLOB_READ_WRITE_TOKEN is set. Locally the app keeps using normal uploads
// and the outputs folder, so nothing changes while you run `npm start` on your own computer.
//   in/<userId>/...   the PDF a user just uploaded (deleted after a successful run)
//   out/<userId>/...  the highlighted PDF (opened through a short-lived signed link)
import { getUser } from './authRoutes.js';
import { AppError } from './errors.js';

export const enabled = !!process.env.BLOB_READ_WRITE_TOKEN;
const MAX_BYTES = 50 * 1024 * 1024;
const LINK_MS = 2 * 60 * 60 * 1000;                       // a result link works for 2 hours
const sdk = () => import('@vercel/blob');                  // loaded only when needed
const bodyOf = async stream => Buffer.from(await new Response(stream).arrayBuffer());

// The browser may only ask for files inside its own folder.
export const inputPathOk = (p, userId) =>
  typeof p === 'string' && !p.includes('..') && new RegExp(`^in/${Number(userId)}/[A-Za-z0-9._-]+\\.pdf$`).test(p);

// Step 1 of an upload: the browser asks this route for permission, then sends the file straight to Blob.
export async function uploadRoute(req, res) {
  try {
    const { handleUpload } = await import('@vercel/blob/client');
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async pathname => {
        const u = await getUser(req);                       // same login check as the rest of the app
        if (!u || !u.email_verified || !u.approved) throw new Error('Please log in.');
        if (!inputPathOk(pathname, u.id)) throw new Error('Bad upload path.');
        return { allowedContentTypes: ['application/pdf'], maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      }
    });
    res.json(json);
  } catch (e) {
    console.error('blob upload:', e.message);
    res.status(400).json({ error: e.message });
  }
}

// Reads the uploaded PDF back into memory for processing.
export async function loadInput(path, user) {
  if (!inputPathOk(path, user.id)) throw new AppError('Upload not found. Choose the file again.', { status: 400 });
  const { get } = await sdk();
  const r = await get(path, { access: 'private' });
  if (!r || r.statusCode !== 200 || !r.stream) throw new AppError('Upload not found. Choose the file again.', { status: 400 });
  const buf = await bodyOf(r.stream);
  if (buf.length > MAX_BYTES) throw new AppError('File is too large (50 MB max).', { status: 400 });
  return buf;
}

export async function removeInput(path) {
  try { const { del } = await sdk(); await del(path); } catch (e) { console.error('could not delete upload:', e.message); }
}

// Stores the finished PDF and returns a signed link the browser can open directly.
export async function saveOutput(userId, id, bytes) {
  const { put, issueSignedToken, presignUrl } = await sdk();
  const b = await put(`out/${Number(userId)}/${id}.pdf`, bytes, { access: 'private', contentType: 'application/pdf', addRandomSuffix: true });
  const token = await issueSignedToken({ pathname: b.pathname, operations: ['get'], validUntil: Date.now() + LINK_MS });
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname: b.pathname, access: 'private' });
  return presignedUrl;
}

// Daily clean-up (Vercel cron): leftover uploads after a day, finished PDFs after a few days.
export async function cleanup() {
  const { list, del } = await sdk();
  const limits = { 'in/': 24 * 3600e3, 'out/': (Number(process.env.KEEP_RESULTS_DAYS) || 3) * 24 * 3600e3 };
  let removed = 0;
  for (const [prefix, maxAge] of Object.entries(limits)) {
    let cursor, more = true;
    while (more) {
      const page = await list({ prefix, cursor, limit: 500 });
      const old = page.blobs.filter(b => Date.now() - new Date(b.uploadedAt).getTime() > maxAge).map(b => b.url);
      if (old.length) { await del(old); removed += old.length; }
      cursor = page.cursor; more = page.hasMore;
    }
  }
  return { removed };
}
