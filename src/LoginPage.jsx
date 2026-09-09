import React, { useState } from 'react';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  function change(next) { setMode(next); setError(''); setMessage(''); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const endpoint = { login: 'login', signup: 'signup', recover: 'recover', reset: 'reset-password', confirm: 'confirm' }[mode];
      const response = await fetch('/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not complete your request.');
      if (mode === 'login') await onLogin(data.user);
      else { setMessage(data.message); setMode(mode === 'recover' ? 'reset' : mode === 'signup' ? 'confirm' : 'login'); }
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  const title = { confirm: 'Confirm your email', login: 'Welcome back', signup: 'Create your account', recover: 'Forgot your password?', reset: 'Set a new password' }[mode];
  const action = { confirm: 'Confirm email', login: 'Log in', signup: 'Create account', recover: 'Send recovery code', reset: 'Update password' }[mode];
  return <main className="login-page"><section className="login-card">
    <div className="eyebrow">SIDEPROJ</div><h1>{title}</h1>
    <p>{mode === 'confirm' ? 'Enter the confirmation code from your email.' : mode === 'signup' ? 'Share climbing knowledge with your community.' : mode === 'recover' ? 'Enter your email to receive a password recovery code.' : mode === 'reset' ? 'Enter the code from your recovery email.' : 'Log in to add your climbing knowledge.'}</p>
    {message && <p role="status">{message}</p>}
    <form onSubmit={submit} key={mode}>
      {error && <p className="error" role="alert">{error}</p>}
      {mode === 'signup' && <label>Display name *<input name="name" required maxLength={120} autoComplete="nickname"/></label>}
      <label>Email *<input name="email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></label>
      {['reset', 'confirm'].includes(mode) && <label>Email code *<input name="code" required autoComplete="one-time-code" inputMode="numeric"/></label>}
      {!['recover', 'confirm'].includes(mode) && <label>Password *<input name="password" type="password" required minLength={mode === 'login' ? undefined : 12} maxLength={256} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/>{mode !== 'login' && <small>At least 12 characters.</small>}</label>}
      <button className="primary" disabled={busy}>{busy ? 'Please wait...' : action}</button>
    </form>
    <div className="account-options">
      {mode === 'login' ? <><button className="secondary" disabled={busy} onClick={() => change('signup')}>Create an account</button><button className="secondary" disabled={busy} onClick={() => change('recover')}>Forgot password?</button><button className="secondary" disabled={busy} onClick={() => change('confirm')}>Enter confirmation code</button></> : <button className="secondary" disabled={busy} onClick={() => change('login')}>Back to log in</button>}
    </div>
    <a href="#explore">Continue as guest</a>
  </section></main>;
}
