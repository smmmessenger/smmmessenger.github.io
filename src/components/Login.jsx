import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Key, Loader2, LogIn, CheckCircle, Wifi } from 'lucide-react';

export default function Login() {
  const { isGoogleReady, isGoogleAuthed, isAutoConnecting, login, unlock, error } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [password, setPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const passwordRef = useRef(null);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    await login();
    setIsLoggingIn(false);
    setTimeout(() => passwordRef.current?.focus(), 100);
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!password || isUnlocking) return;

    setIsUnlocking(true);
    setUnlockError('');

    const result = await unlock(password);

    if (!result.success) {
      setUnlockError(result.error);
      setPassword('');
      passwordRef.current?.focus();
    }
    setIsUnlocking(false);
  };

  // Determine which step we're on
  const step =
    !isGoogleReady ? 'loading' :
    isAutoConnecting ? 'auto-connecting' :
    !isGoogleAuthed ? 'google' :
    'password';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.15) 0%, transparent 60%), var(--bg-primary)',
    }}>
      <div className="glass-panel animate-fade-in" style={{
        width: '100%',
        maxWidth: '400px',
        padding: '2.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        alignItems: 'center',
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '24px',
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 32px var(--accent-glow)',
        }}>
          <Shield size={40} color="white" />
        </div>

        <div>
          <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem' }}>SMM Messenger</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            Your private, end-to-end encrypted vault
          </p>
        </div>

        {/* Global error */}
        {error && (
          <div style={{
            width: '100%',
            color: 'var(--error)',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        {/* Loading Google scripts */}
        {step === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)' }}>
            <Loader2 className="lucide-spin" size={28} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>Loading…</p>
          </div>
        )}

        {/* Auto-connecting (silent Google reconnect in progress) */}
        {step === 'auto-connecting' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)' }}>
            <Wifi className="lucide-spin" size={24} color="var(--accent-primary)" />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>Reconnecting to Google Drive…</p>
          </div>
        )}

        {/* Manual sign-in (only shown if silent reconnect failed) */}
        {step === 'google' && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center' }}>
              <StepBadge n={1} active />
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Connect your Google Drive to store your encrypted messages.
              </p>
            </div>
            <button
              id="google-signin-btn"
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? <Loader2 className="lucide-spin" size={18} /> : <LogIn size={18} />}
              {isLoggingIn ? 'Signing in…' : 'Sign in with Google'}
            </button>
            <StepIndicator current={1} />
          </div>
        )}

        {/* Master password */}
        {step === 'password' && (
          <form
            id="unlock-form"
            onSubmit={handleUnlock}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}
            autoComplete="off"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center' }}>
              <CheckCircle size={18} color="var(--success)" />
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--success)' }}>
                Google Drive connected
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center' }}>
              <StepBadge n={2} active />
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Enter your master password to decrypt your messages.
              </p>
            </div>

            <div style={{ position: 'relative' }}>
              <Key
                size={16}
                style={{
                  position: 'absolute', left: '1rem', top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--text-secondary)',
                  pointerEvents: 'none',
                }}
              />
              <input
                ref={passwordRef}
                id="master-password"
                type="password"
                className="input"
                placeholder="Master password"
                style={{ paddingLeft: '2.5rem' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isUnlocking}
                autoComplete="new-password"
                autoFocus
              />
            </div>

            {unlockError && (
              <p style={{ color: 'var(--error)', fontSize: '0.875rem', margin: 0 }}>{unlockError}</p>
            )}

            <button
              id="unlock-btn"
              className="btn btn-primary"
              type="submit"
              disabled={isUnlocking || !password}
              style={{ width: '100%' }}
            >
              {isUnlocking ? <Loader2 className="lucide-spin" size={18} /> : <Shield size={18} />}
              {isUnlocking ? 'Unlocking…' : 'Unlock'}
            </button>

            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: 0.7, margin: 0 }}>
              First time? This sets your master password — it&apos;s never sent anywhere and cannot be recovered.
            </p>
            <StepIndicator current={2} />
          </form>
        )}
      </div>
    </div>
  );
}

function StepBadge({ n, active }) {
  return (
    <div style={{
      minWidth: '24px', height: '24px', borderRadius: '50%',
      background: active ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'var(--bg-tertiary)',
      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', fontWeight: 700,
    }}>
      {n}
    </div>
  );
}

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
      {[1, 2].map((s) => (
        <div key={s} style={{
          width: s === current ? '20px' : '6px',
          height: '6px', borderRadius: '3px',
          background: s === current ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
          transition: 'width 0.3s ease, background 0.3s ease',
        }} />
      ))}
    </div>
  );
}
