// Sign-up, email verification, login/logout, "who am I", and the admin approval endpoints.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { query, dayKey } from './db.js';
import { AppError, friendly } from './errors.js';
import { isValidEmail, normalizeEmail, isDisposable } from './email.js';
import { sendVerification } from './mailer.js';
import { throttled, noteFail, clearFails } from './throttle.js';
import { remaining, isLoopback, getLimits, setLimits } from './usage.js';

const sha = s => createHash('sha256').update(s).digest('hex');
const SESSION_DAYS = 30;
const SIGNUP_IP_LIMIT = Number(process.env.SIGNUP_IP_LIMIT) || 2;       // new accounts per IP per 24 hours
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ? normalizeEmail(process.env.ADMIN_EMAIL) : '';
// EMAIL_VERIFICATION=off skips the email step: new accounts are ready at once and only wait for your approval.
const VERIFY_EMAIL = String(process.env.EMAIL_VERIFICATION || 'on').trim().toLowerCase() !== 'off';
const SECURE = APP_URL.startsWith('https');
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);           // keeps login timing the same for unknown emails

// ---- helpers ----
export function clientIp(req) {
  let ip = '';
  if (process.env.TRUST_PROXY === '1') ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); // only behind a real proxy
  return (ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { } }
  }
  return out;
}
const setSession = (res, token) =>
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${SECURE ? '; Secure' : ''}`);
const clearSession = res =>
  res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}`);

export async function getUser(req) {
  const token = cookies(req).sid;
  if (!token) return null;
  const r = await query(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()', [sha(token)]);
  return r.rows[0] ?? null;
}

// Blocks POSTs that were started from another website.
export function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try { if (new URL(origin).host === req.headers.host) return next(); } catch { }
  res.status(403).json({ error: 'Blocked: this request came from another website.' });
}

async function gate(req, res, next, adminOnly) {
  try {
    const u = await getUser(req);
    if (!u) return res.status(401).json({ error: 'Please log in.' });
    if (!u.email_verified || !u.approved) return res.status(403).json({ error: 'This account is not active yet.' });
    if (adminOnly && u.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
    req.user = u;
    next();
  } catch (e) {
    console.error(e.message);
    res.status(503).json({ error: 'The database is not reachable. Try again in a moment.' });
  }
}
export const requireUser = (req, res, next) => gate(req, res, next, false);
const requireAdmin = (req, res, next) => gate(req, res, next, true);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = Router();

// ---- sign up ----
router.post('/signup', wrap(async (req, res) => {
  const rawEmail = String(req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!isValidEmail(rawEmail)) throw new AppError('Enter a valid email address.', { status: 400 });
  if (password.length < 8 || password.length > 72) throw new AppError('Password must be 8 to 72 characters.', { status: 400 });
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AppError('Enter a valid email address.', { status: 400 });
  if (isDisposable(email)) throw new AppError('Disposable email addresses are not allowed. Use your real email.', { status: 400 });

  const ip = clientIp(req);
  if (!isLoopback(ip)) {
    const c = await query(`SELECT count(*)::int AS n FROM users WHERE signup_ip = $1 AND created_at > now() - interval '24 hours'`, [ip]);
    if (c.rows[0].n >= SIGNUP_IP_LIMIT) throw new AppError('Too many accounts were created from your network. Try again tomorrow.', { status: 429 });
  }

  const existing = (await query('SELECT id, email_verified, verify_expires FROM users WHERE email = $1', [email])).rows[0];
  if (existing?.email_verified) throw new AppError('An account with this email already exists. Log in instead.', { status: 409 });
  // an unverified account can be re-registered (e.g. lost email), but not more than once every 5 minutes
  if (VERIFY_EMAIL && existing?.verify_expires && existing.verify_expires.getTime() > Date.now() + 24 * 3600e3 - 5 * 60e3) {
    throw new AppError('We just sent you a verification email. Check your inbox, or try again in a few minutes.', { status: 429 });
  }

  const hash = await bcrypt.hash(password, 10);
  if (!VERIFY_EMAIL) {   // no email step: the account counts as verified, and only waits for admin approval
    if (existing) {
      await query(`UPDATE users SET password_hash = $2, email_display = $3, email_verified = true, verify_token_hash = NULL, verify_expires = NULL, signup_ip = $4 WHERE id = $1`,
        [existing.id, hash, rawEmail, ip]);
    } else {
      await query(`INSERT INTO users (email, email_display, password_hash, email_verified, signup_ip) VALUES ($1, $2, $3, true, $4)`,
        [email, rawEmail, hash, ip]);
    }
    return res.json({ message: 'Account created. You can log in once the admin approves it.' });
  }
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 3600e3);
  if (existing) {
    await query(`UPDATE users SET password_hash = $2, email_display = $3, verify_token_hash = $4, verify_expires = $5, signup_ip = $6 WHERE id = $1`,
      [existing.id, hash, rawEmail, sha(token), expires, ip]);
  } else {
    await query(`INSERT INTO users (email, email_display, password_hash, verify_token_hash, verify_expires, signup_ip) VALUES ($1, $2, $3, $4, $5, $6)`,
      [email, rawEmail, hash, sha(token), expires, ip]);
  }
  await sendVerification(rawEmail, `${APP_URL}/api/verify?token=${token}`);
  res.json({ message: 'Account created. Open the verification link we emailed you, then wait for approval.' });
}));

// ---- email verification link ----
router.get('/verify', wrap(async (req, res) => {
  const token = String(req.query.token || '');
  let ok = false;
  if (token) {
    const r = await query(
      `UPDATE users SET email_verified = true, verify_token_hash = NULL, verify_expires = NULL,
         role = CASE WHEN email = $2 THEN 'admin' ELSE role END,
         approved = CASE WHEN email = $2 THEN true ELSE approved END
       WHERE verify_token_hash = $1 AND verify_expires > now() RETURNING id`, [sha(token), ADMIN_EMAIL]);
    ok = r.rowCount > 0;
  }
  res.redirect(`/?verified=${ok ? 1 : 0}`);
}));

// ---- log in / out ----
router.post('/login', wrap(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email ?? ''));
  const password = String(req.body?.password ?? '');
  const ip = clientIp(req), k1 = `${ip}|${email}`, k2 = ip;
  if (await throttled(k1, 5) || await throttled(k2, 30)) throw new AppError('Too many login attempts. Wait 15 minutes and try again.', { status: 429 });

  const u = email ? (await query('SELECT * FROM users WHERE email = $1', [email])).rows[0] : null;
  const ok = await bcrypt.compare(password.slice(0, 72), u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) {await noteFail(k1); await noteFail(k2); throw new AppError('Wrong email or password.', { status: 401 }); }
  if (!u.email_verified) throw new AppError('Verify your email first: open the link we sent you.', { status: 403 });
  if (!u.approved) throw new AppError('Your account is waiting for approval. You can log in once it is approved.', { status: 403 });

  await clearFails(k1);;
  const token = randomBytes(32).toString('hex');
  await query('DELETE FROM sessions WHERE expires_at < now()');
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha(token), u.id, new Date(Date.now() + SESSION_DAYS * 86400e3)]);
  setSession(res, token);
  res.json({ ok: true });
}));

router.post('/logout', wrap(async (req, res) => {
  const token = cookies(req).sid;
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
  clearSession(res);
  res.json({ ok: true });
}));

router.get('/me', wrap(async (req, res) => {
  const u = await getUser(req);
  if (!u || !u.email_verified || !u.approved) return res.json({ user: null, emailVerification: VERIFY_EMAIL });
  res.json({ user: { email: u.email_display, role: u.role }, usage: await remaining(u) });
}));

// ---- admin ----
router.get('/admin/users', requireAdmin, wrap(async (req, res) => {
  const r = await query(
    `SELECT u.id, u.email_display AS email, u.role, u.email_verified AS verified, u.approved, u.created_at AS "createdAt",
            u.signup_ip AS ip, COALESCE(x.count, 0)::int AS "usedToday"
     FROM users u LEFT JOIN usage x ON x.user_id = u.id AND x.day = $1
     ORDER BY u.approved, u.created_at DESC`, [dayKey()]);
  res.json({ users: r.rows, limits: await getLimits() });
}));

router.post('/admin/approve', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.body?.id, 10), approved = !!req.body?.approved;
  if (!id || id === req.user.id) throw new AppError('You cannot change your own account here.', { status: 400 });
  await query(`UPDATE users SET approved = $2 WHERE id = $1 AND role <> 'admin'`, [id, approved]);
  if (!approved) await query('DELETE FROM sessions WHERE user_id = $1', [id]); // revoking logs them out
  res.json({ ok: true });
}));

router.post('/admin/delete', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.body?.id, 10);
  if (!id || id === req.user.id) throw new AppError('You cannot delete your own account.', { status: 400 });
  await query(`DELETE FROM users WHERE id = $1 AND role <> 'admin'`, [id]);
  res.json({ ok: true });
}));

// make an account special (higher daily limit) or put it back to normal
router.post('/admin/special', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.body?.id, 10), special = !!req.body?.special;
  if (!id) throw new AppError('Pick an account first.', { status: 400 });
  await query(`UPDATE users SET role = $2 WHERE id = $1 AND role <> 'admin'`, [id, special ? 'special' : 'user']);
  res.json({ ok: true });
}));

// the two daily limits: normal accounts and special accounts
router.post('/admin/limits', requireAdmin, wrap(async (req, res) => {
  const user = Number(req.body?.user), special = Number(req.body?.special);
  if (![user, special].every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) {
    throw new AppError('Limits must be whole numbers from 0 to 1000.', { status: 400 });
  }
  await setLimits(user, special);
  res.json({ ok: true, limits: { user, special } });
}));

router.use((e, req, res, next) => {
  console.error(e.detail || e);
  res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: friendly(e) });
});

export default router;