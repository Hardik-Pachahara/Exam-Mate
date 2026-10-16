// Email helpers: make "one inbox = one account", and block throwaway addresses.
// The disposable list is a starter list; add more domains whenever you spot one.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'sharklasers.com',
  'grr.la', 'spam4.me', '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io',
  'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email', 'trashmail.com', 'trashmail.net',
  'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'tempail.com',
  'tempr.email', 'discard.email', 'spamgourmet.com', 'mailnesia.com', 'burnermail.io', 'moakt.com', 'tmpmail.org',
  'tmpmail.net', 'mail.tm', 'inboxkitten.com', 'mytemp.email', 'emailfake.com', 'fakemail.net', 'mailcatch.com',
  'mailforspam.com', '1secmail.com', '1secmail.net', '1secmail.org', 'dropmail.me', 'harakirimail.com',
  'tempinbox.com', 'jetable.org', 'minuteinbox.com', 'owlymail.com', 'getairmail.com', 'emltmp.com', 'tempmailo.com'
]);

export const isValidEmail = s => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// Lowercase, drop "+tag", and for Gmail also drop dots: me+2@gmail.com and m.e@gmail.com become me@gmail.com.
export function normalizeEmail(raw) {
  const [local0, domain0] = String(raw).trim().toLowerCase().split('@');
  if (!local0 || !domain0) return '';
  let local = local0.split('+')[0];
  let domain = domain0;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local ? `${local}@${domain}` : '';
}

export function isDisposable(email) {
  const domain = email.split('@')[1];
  return DISPOSABLE.has(domain) || [...DISPOSABLE].some(d => domain.endsWith('.' + d));
}
