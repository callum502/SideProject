import React, { useEffect, useRef, useState } from 'react';

const screens = {
  login: { title: 'Welcome back', description: 'Log in to share your climbing knowledge.', action: 'Log in' },
  signup: { title: 'Find your community', description: 'Create an account to share locations, problems and beta.', action: 'Send verification code' },
  recover: { title: 'Reset your password', description: 'We’ll email you a code to set a new password.', action: 'Send recovery code' },
  reset: { title: 'Choose a new password', description: 'Enter your recovery code and a new password below.', action: 'Update password' },
  confirm: { title: 'Check your inbox', description: 'Enter the code from your sign-up email to verify your account.', action: 'Verify email' },
};

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(''), [showPassword, setShowPassword] = useState(false);
  const heading = useRef(null), previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current !== mode) { setShowPassword(false); heading.current?.focus(); previousMode.current = mode; }
  }, [mode]);
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
  const screen = screens[mode];
  const hasPassword = ['login', 'signup', 'reset'].includes(mode);
  return <main className="login-page"><div className="login-layout"><section className="login-card" aria-labelledby="login-title">
    {mode !== 'login' && <button type="button" className="auth-link auth-back" disabled={busy} onClick={() => change('login')}><span aria-hidden="true">← </span>Back to log in</button>}
    <div className="auth-heading">
      <div className="eyebrow">WELCOME TO SIDEPROJ</div>
      <h1 id="login-title" ref={heading} tabIndex={-1}>{screen.title}</h1>
      <p>{screen.description}</p>
    </div>
    {message && <p className="auth-notice" role="status">{message}</p>}
    {error && <p className="error auth-error" role="alert">{error}</p>}
    <form onSubmit={submit} key={mode}>
      <fieldset className="auth-fields" disabled={busy}>
        {mode === 'signup' && <label>Display name *<input name="name" required maxLength={120} autoComplete="nickname" placeholder="How you’d like to be known"/></label>}
        <label>Email *<input name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}/></label>
        {['reset', 'confirm'].includes(mode) && <label>Email code *<input className="auth-code" name="code" required autoComplete="one-time-code" inputMode="numeric" placeholder="Enter your code"/></label>}
        {hasPassword && <div className="auth-password-field">
          <label htmlFor="auth-password">{mode === 'reset' ? 'New password' : 'Password'} *</label>
          <div className="auth-password-input"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'login' ? undefined : 12} maxLength={256} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode !== 'login' ? 'password-hint' : undefined}/><button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button></div>
          {mode !== 'login' && <small id="password-hint">At least 12 characters.</small>}
          {mode === 'login' && <div className="auth-recovery"><button type="button" className="auth-link" onClick={() => change('recover')}>Forgot password?</button></div>}
        </div>}
        <button className="primary auth-submit" type="submit">{busy ? 'Please wait…' : screen.action}</button>
      </fieldset>
    </form>
    {mode === 'login' && <p className="auth-switch">New here? <button type="button" className="auth-link" disabled={busy} onClick={() => change('signup')}>Sign up</button></p>}
    {mode === 'signup' && <p className="auth-switch">Already have a confirmation code? <button type="button" className="auth-link" disabled={busy} onClick={() => change('confirm')}>Verify your email</button></p>}
  </section><div className="auth-guest"><span>Just exploring?</span> <a href="#explore">Continue as guest <span aria-hidden="true">→</span></a></div></div></main>;
}
