// Admin dashboard: approve / revoke, make special / normal, delete, and edit the daily limits.
// Everything is built with textContent only, so an email address can never inject HTML.
const $ = id => document.getElementById(id);
const msg = (t, err) => { $('adminMsg').textContent = t; $('adminMsg').className = err ? 'error' : ''; };
let limits = { user: 0, special: 0 };

async function call(url, body) {
  let res;
  try { res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); }
  catch { return { ok: false, status: 0, data: { error: 'Cannot reach the app server.' } }; }
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

function statusTag(u) {
  if (u.role === 'admin') return el('span', 'Active', 'tag good');
  if (!u.verified) return el('span', 'Email not verified', 'tag bad');
  return u.approved ? el('span', 'Approved', 'tag good') : el('span', 'Waiting for approval', 'tag wait');
}

function typeTag(u) {
  if (u.role === 'admin') return el('span', 'Admin', 'tag admin');
  return u.role === 'special' ? el('span', 'Special', 'tag special') : el('span', 'Normal', 'tag');
}

const limitOf = u => u.role === 'admin' ? 'unlimited' : String(u.role === 'special' ? limits.special : limits.user);

function button(label, cls, onClick) {
  const b = el('button', label, `act ${cls}`);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function act(url, body, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  const { ok, data } = await call(url, body);
  if (!ok) return msg(data.error || 'That did not work.', true);
  msg('');
  load();
}

async function load() {
  const { ok, status, data } = await call('/api/admin/users');
  if (!ok) {
    $('tableWrap').hidden = true; $('limitsForm').hidden = true;
    return msg(status === 401 ? 'Log in as the admin first, from the main page.' : status === 403 ? 'This page is for the admin only.' : (data.error || 'Could not load accounts.'), true);
  }
  limits = data.limits;
  if (document.activeElement !== $('limUser') && document.activeElement !== $('limSpecial')) {
    $('limUser').value = limits.user; $('limSpecial').value = limits.special;
  }
  $('limitsForm').hidden = false;
  if (!$('adminMsg').className) msg(data.users.length ? '' : 'No accounts yet.');
  $('tableWrap').hidden = !data.users.length;

  const rows = $('rows');
  rows.replaceChildren();
  for (const u of data.users) {
    const tr = el('tr');
    const used = el('td', `${u.usedToday} of ${limitOf(u)}`);
    const status = el('td'); status.append(statusTag(u));
    const type = el('td'); type.append(typeTag(u));
    const actions = el('td');
    if (u.role !== 'admin') {
      actions.append(
        u.approved
          ? button('Revoke', '', () => act('/api/admin/approve', { id: u.id, approved: false }, `Revoke access for ${u.email}? They will be logged out.`))
          : button('Approve', 'ok', () => act('/api/admin/approve', { id: u.id, approved: true })),
        u.role === 'special'
          ? button('Make normal', '', () => act('/api/admin/special', { id: u.id, special: false }))
          : button('Make special', 'gold', () => act('/api/admin/special', { id: u.id, special: true })),
        button('Remove', 'danger', () => act('/api/admin/delete', { id: u.id }, `Remove ${u.email} permanently? Their account and usage history are deleted and they are logged out.`))
      );
    }
    tr.append(el('td', u.email), status, type, used, el('td', new Date(u.createdAt).toLocaleDateString()), el('td', u.ip || ''), actions);
    rows.append(tr);
  }
}

$('limitsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { ok, data } = await call('/api/admin/limits', { user: Number($('limUser').value), special: Number($('limSpecial').value) });
  if (!ok) return msg(data.error || 'Could not save the limits.', true);
  msg('Limits saved.');
  load();
});

load();