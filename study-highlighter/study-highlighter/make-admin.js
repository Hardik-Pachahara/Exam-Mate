// Run once after you have signed up on the site:   node make-admin.js you@gmail.com
// Makes that account an admin (unlimited highlights, access to the approval page).
import './src/loadEnv.js';
import { query, initDb, pool } from './src/db.js';
import { normalizeEmail } from './src/email.js';

const email = normalizeEmail(process.argv[2] || '');
if (!email) { console.log('Usage: node make-admin.js you@gmail.com   (sign up on the website first)'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.log('Set DATABASE_URL in your .env file first.'); process.exit(1); }
await initDb();
const r = await query(`UPDATE users SET role = 'admin', approved = true, email_verified = true WHERE email = $1 RETURNING email_display`, [email]);
console.log(r.rowCount ? `${r.rows[0].email_display} is now an admin.` : 'No account with that email. Sign up on the website first, then run this again.');
await pool.end();
