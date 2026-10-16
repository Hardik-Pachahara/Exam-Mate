// Login attempt limits, kept in the database so they work on Vercel, where each request can
// run on a different server instance (an in-memory counter would not be shared).
import { query } from './db.js';

// Is this key (an email+IP pair, or just an IP) currently locked out?
export async function throttled(key, max) {
  const r = await query('SELECT 1 FROM login_fails WHERE key = $1 AND n >= $2 AND until_at > now()', [key, max]);
  return r.rowCount > 0;
}

// Count one failed login. The 15 minute window starts at the first failure.
export async function noteFail(key) {
  await query(
    `INSERT INTO login_fails (key, n, until_at) VALUES ($1, 1, now() + interval '15 minutes')
     ON CONFLICT (key) DO UPDATE SET
       n = CASE WHEN login_fails.until_at <= now() THEN 1 ELSE login_fails.n + 1 END,
       until_at = CASE WHEN login_fails.until_at <= now() THEN now() + interval '15 minutes' ELSE login_fails.until_at END`, [key]);
  if (Math.random() < 0.05) await query(`DELETE FROM login_fails WHERE until_at < now() - interval '1 day'`).catch(() => {});
}

export const clearFails = key => query('DELETE FROM login_fails WHERE key = $1', [key]);
