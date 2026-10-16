// Neon (Postgres) connection + table setup.
import pg from 'pg';

export const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
// Today's date in your timezone, e.g. "2026-10-10". Daily limits reset when this changes (midnight IST by default).
export const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

const ON_VERCEL = !!process.env.VERCEL;
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: ON_VERCEL ? 3 : 5,                    // many short-lived server instances: keep each one small (use Neon's pooled connection string)
  idleTimeoutMillis: ON_VERCEL ? 5000 : 10000, // Neon suspends idle databases, so don't hold old connections
  connectionTimeoutMillis: 15000,            // the first query after a quiet spell has to wake Neon up
  allowExitOnIdle: true
});
pool.on('error', e => console.error('Database connection dropped:', e.message));

export const query = (text, params) => pool.query(text, params);

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,             -- normalized: one real inbox = one account
      email_display TEXT NOT NULL,            -- what the person typed
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',      -- 'user', 'special' or 'admin'
      email_verified BOOLEAN NOT NULL DEFAULT false,
      approved BOOLEAN NOT NULL DEFAULT false,
      verify_token_hash TEXT,
      verify_expires TIMESTAMPTZ,
      signup_ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- added later: a custom daily limit for one account (NULL = use the default for its type)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_limit INTEGER;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS ip_usage (
      ip TEXT NOT NULL,
      day DATE NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ip, day)
    );
    -- limits you change from the admin dashboard (they win over the .env defaults)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- failed logins, counted here (not in memory) so the limit works across Vercel server instances
    CREATE TABLE IF NOT EXISTS login_fails (
      key TEXT PRIMARY KEY,
      n INTEGER NOT NULL,
      until_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS global_usage (
      day DATE PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    );
  `);
}