// Sends the verification email through Resend (plain HTTPS call, no extra package).
// Without RESEND_API_KEY the link is printed in the terminal instead, which is handy while testing.
import { AppError } from './errors.js';

export async function sendVerification(to, link) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) {
    console.log(`\n[RESEND_API_KEY not set] Verification link for ${to}:\n${link}\n`);
    return;
  }
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Marginalia <onboarding@resend.dev>',
        to: [to],
        subject: 'Verify your email for Marginalia',
        html: `<p>Welcome to Marginalia.</p><p><a href="${link}">Verify my email</a></p><p>This link works for 24 hours. If you didn't sign up, ignore this email.</p>`
      })
    });
  } catch (e) {
    throw new AppError('Could not send the verification email. Try again later.', { status: 502, kind: 'mail', detail: e.message });
  }
  if (!res.ok) {
    throw new AppError('Could not send the verification email. Try again later.', { status: 502, kind: 'mail', detail: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` });
  }
}
