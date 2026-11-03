// Basic protections for every response from the Express app (API calls, and all pages when running locally).
// On Vercel the static pages are served by Vercel itself, so their headers are set in vercel.json instead.
export default function security(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');          // browser must not guess file types
  res.setHeader('X-Frame-Options', 'DENY');                    // no other site can show this one in a frame
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.removeHeader('X-Powered-By');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');   // account and result data is never cached
  next();
}
