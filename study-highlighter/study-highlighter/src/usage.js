// Daily limits. Three kinds of account:
//   normal  -> "user_limit" highlights per day, plus the per-IP and global caps
//   special -> "special_limit" highlights per day (skips the per-IP cap, still counts toward the global cap)
//   admin   -> unlimited
// The two limits live in the database (settings table) so you can change them from the admin dashboard
// without restarting. DAILY_LIMIT / SPECIAL_DAILY_LIMIT in .env are only the starting values.
// A run is reserved BEFORE it starts (atomically, so two tabs can't sneak past the limit)
// and given back if the run fails, so only successful runs use up an attempt.
import { query, dayKey, TZ } from './db.js';

const DEFAULT_USER = Number(process.env.DAILY_LIMIT) || 5;
const DEFAULT_SPECIAL = Number(process.env.SPECIAL_DAILY_LIMIT) || 25;
const IP_LIMIT = Number(process.env.IP_DAILY_LIMIT) || 10;
const GLOBAL_LIMIT = Number(process.env.GLOBAL_DAILY_LIMIT) || 100;

export const isLoopback = ip => !ip || ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';

export async function getLimits() {
  const r = await query(`SELECT key, value FROM settings WHERE key IN ('user_limit', 'special_limit')`);
  const m = Object.fromEntries(r.rows.map(x => [x.key, Number(x.value)]));
  return {
    user: Number.isInteger(m.user_limit) ? m.user_limit : DEFAULT_USER,
    special: Number.isInteger(m.special_limit) ? m.special_limit : DEFAULT_SPECIAL
  };
}

export async function setLimits(user, special) {
  await query(
    `INSERT INTO settings (key, value) VALUES ('user_limit', $1), ('special_limit', $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(user), String(special)]);
}

const limitFor = (user, limits) => user.role === 'special' ? limits.special : limits.user;

export async function remaining(user) {
  if (user.role === 'admin') return { unlimited: true };
  const limit = limitFor(user, await getLimits());
  const r = await query('SELECT count FROM usage WHERE user_id = $1 AND day = $2', [user.id, dayKey()]);
  const used = Number(r.rows[0]?.count ?? 0);
  return { limit, used, left: Math.max(limit - used, 0) };
}

export async function reserveRun(user, ip) {
  if (user.role === 'admin') return { ok: true, refund: async () => {} };
  const day = dayKey();
  const limit = limitFor(user, await getLimits());

  const steps = [{
    limit, params: [user.id, day, limit],
    take: `INSERT INTO usage (user_id, day, count) VALUES ($1, $2, 1)
           ON CONFLICT (user_id, day) DO UPDATE SET count = usage.count + 1 WHERE usage.count < $3 RETURNING count`,
    undo: 'UPDATE usage SET count = GREATEST(count - 1, 0) WHERE user_id = $1 AND day = $2',
    message: `You have used all ${limit} highlights for today. It resets at midnight (${TZ}).`
  }];
  if (user.role !== 'special' && !isLoopback(ip)) steps.push({
    limit: IP_LIMIT, params: [ip, day, IP_LIMIT],
    take: `INSERT INTO ip_usage (ip, day, count) VALUES ($1, $2, 1)
           ON CONFLICT (ip, day) DO UPDATE SET count = ip_usage.count + 1 WHERE ip_usage.count < $3 RETURNING count`,
    undo: 'UPDATE ip_usage SET count = GREATEST(count - 1, 0) WHERE ip = $1 AND day = $2',
    message: 'Too many highlights from your network today. Try again tomorrow.'
  });
  steps.push({
    limit: GLOBAL_LIMIT, params: [day, GLOBAL_LIMIT],
    take: `INSERT INTO global_usage (day, count) VALUES ($1, 1)
           ON CONFLICT (day) DO UPDATE SET count = global_usage.count + 1 WHERE global_usage.count < $2 RETURNING count`,
    undo: 'UPDATE global_usage SET count = GREATEST(count - 1, 0) WHERE day = $1',
    message: 'The app has reached its total limit for today. Try again tomorrow.'
  });

  const taken = [];
  const refund = async () => {
    for (const s of taken) await query(s.undo, s.params.slice(0, s.undo.includes('$2') ? 2 : 1)).catch(e => console.error('refund failed:', e.message));
    taken.length = 0;
  };
  for (const s of steps) {
    const got = s.limit >= 1 && (await query(s.take, s.params)).rowCount > 0; // a limit of 0 blocks everyone on that tier
    if (!got) { await refund(); return { ok: false, message: s.message }; }
    taken.push(s);
  }
  return { ok: true, refund };
}