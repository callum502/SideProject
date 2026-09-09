import React, { useState } from 'react';

export default function LoginPage({ onLogin }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not log in.');
      onLogin(data.user);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-card"><div className="eyebrow">SIDEPROJ</div><h1>Welcome back</h1><p>Log in to add your climbing knowledge.</p><form onSubmit={submit}>{error && <p className="error" role="alert">{error}</p>}<label>Username<input name="username" required autoComplete="username" autoFocus/></label><label>Password<input name="password" type="password" required autoComplete="current-password"/></label><button className="primary" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button></form><div className="demo-accounts"><strong>Demo accounts</strong><p>Admin / Password<br/>Contributor / Password</p></div><a href="#explore">Continue as guest</a></section></main>;
}
