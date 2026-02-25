'use client';

import { useState } from 'react';
import { useSignIn, useSignUp } from '@/lib/auth-client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const { signIn, isLoading: isSigningIn, error: signInError } = useSignIn();
  const { signUp, isLoading: isSigningUp, error: signUpError } = useSignUp();
  const [lastError, setLastError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setLastError('');

    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, email.split('@')[0]);
        window.location.href = '/dashboard';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion';
      setLastError(message);
    }
  };

  const isLoading = isSigningIn || isSigningUp;
  const error = lastError || signInError?.message || signUpError?.message || '';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--bg-base)',
      padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>GENESIS</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>AI Media Planning Platform</div>
        </div>

        {/* Login card */}
        <div className="g-card">
          <div className="g-card-header">
            <span className="g-card-title">{mode === 'login' ? 'Connexion' : 'Inscription'}</span>
          </div>
          <div className="g-card-body">
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="g-label">Email</label>
                <input
                  type="email"
                  className="g-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nom@entreprise.com"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="g-label">Mot de passe</label>
                <input
                  type="password"
                  className="g-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {error && <div className="g-alert g-alert-error">{error}</div>}

              <button
                type="submit"
                className="g-btn g-btn-primary"
                disabled={isLoading}
                style={{ width: '100%', justifyContent: 'center', padding: '10px 0' }}
              >
                {isLoading ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : mode === 'login' ? 'Se connecter' : 'Creer un compte'}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-dim)' }}>
              {mode === 'login' ? (
                <span>Pas de compte ? <button onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}>Inscription</button></span>
              ) : (
                <span>Deja un compte ? <button onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}>Connexion</button></span>
              )}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
          // Supabase Auth — v4
        </div>
      </div>
    </div>
  );
}
