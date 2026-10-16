// Login / sign-up screen and the small user bar. Loaded BEFORE app.js.
(function () {
  const element = id => document.getElementById(id);
  let mode = 'login';

  const say = (text, err) => { element('authMsg').textContent = text; element('authMsg').className = err ? 'error' : 'ok'; };

  async function api(url, body) {
    let res;
    try {
      res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    } catch { return { ok: false, data: { error: 'Cannot reach the app server. Is it still running in the terminal?' } }; }
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  function setMode(m) {
    mode = m;
    const login = m === 'login';
    element('authTitle').textContent = login ? 'Log in' : 'Create an account';
    element('authGo').textContent = login ? 'Log in' : 'Sign up';
    element('authSwitchText').textContent = login ? 'New here?' : 'Already have an account?';
    element('authSwitch').textContent = login ? 'Create an account' : 'Log in';
    element('authPass').autocomplete = login ? 'current-password' : 'new-password';
    element('authHint').hidden = login;
    say('');
  }

  function fillBar({ user, usage }) {
    element('who').textContent = user.email;
    element('left').textContent = usage?.unlimited ? 'Unlimited highlights' : usage ? `${usage.left} of ${usage.limit} highlights left today` : '';
    element('adminLink').hidden = user.role !== 'admin';
  }

  // app.js calls this after every successful run so the counter stays current
  window.refreshMe = async () => {
    const { data } = await api('/api/me');
    if (data.user) fillBar(data);
  };

  async function init() {
    const { data } = await api('/api/me');
    if (data.user) {
      fillBar(data);
      element('userbar').hidden = false;
      element('upload').hidden = false;
      return;
    }
    if (data.emailVerification === false) element('authHint').textContent = 'At least 8 characters. After you sign up, wait for the admin to approve your account, then log in.';
    element('auth').hidden = false;
    const v = new URLSearchParams(location.search).get('verified');
    if (v === '1') say('Email verified. Once your account is approved you can log in.');
    else if (v === '0') say('That verification link is invalid or has expired. Sign up again to get a new one.', true);
    if (v !== null) history.replaceState(null, '', '/');
  }

  element('authSwitch').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));

  element('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = element('authEmail').value.trim(), password = element('authPass').value;
    if (!email || !password) return say('Enter your email and password.', true);
    element('authGo').disabled = true;
    say(mode === 'login' ? 'Logging in...' : 'Creating your account...');
    const { ok, data } = await api(mode === 'login' ? '/api/login' : '/api/signup', { email, password });
    element('authGo').disabled = false;
    if (!ok) return say(data.error || 'Something went wrong. Try again.', true);
    if (mode === 'login') return location.reload();
    element('authPass').value = '';
    say(data.message || 'Account created. Check your email.');
  });

  element('logout').addEventListener('click', async () => { await api('/api/logout', {}); location.reload(); });

  setMode('login');
  init();
})();
