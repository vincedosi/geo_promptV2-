'use client';

import { useState } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useSignIn, useSignUp } from '@/lib/auth-client';

// ─── Preserved exactly from original ──────────────────────────────────────────
function formatAuthError(message: string, status?: number): string {
  const m = message.toLowerCase();
  const s = status ?? 0;
  if (s === 504 || m.includes('timeout') || m.includes('i/o timeout') || m.includes('gateway timeout')) {
    return '! Le serveur est temporairement indisponible (maintenance ou surcharge). Réessayez dans quelques minutes. Si le problème persiste, vérifiez le dashboard Supabase.';
  }
  if (s === 409 || m.includes('too many concurrent')) {
    return '! Trop de requêtes simultanées. Attendez 30 secondes et réessayez.';
  }
  if (s === 500 || m.includes('dial tcp') || m.includes('connection refused')) {
    return '! La base de données redémarre (changement de configuration en cours). Réessayez dans 5-10 minutes.';
  }
  return message;
}

// ─── Design tokens ─────────────────────────────────────────────────────────────
const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono','Fira Mono',monospace";

export default function LoginPage() {
  // ── Auth state — preserved exactly ──────────────────────────────────────────
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [mode,     setMode]     = useState<'login' | 'signup'>('login');
  const { signIn, isLoading: isSigningIn, error: signInError } = useSignIn();
  const { signUp, isLoading: isSigningUp, error: signUpError } = useSignUp();
  const [lastError,     setLastError]     = useState('');
  const [showPassword,  setShowPassword]  = useState(false);

  // ── Handlers — preserved exactly ────────────────────────────────────────────
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
      const message = err instanceof Error
        ? err.message
        : (typeof err === 'object' && err !== null && 'message' in err)
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err) || 'Erreur de connexion';
      setLastError(message);
    }
  };

  const isLoading = isSigningIn || isSigningUp;
  const error = lastError || signInError?.message || String(signInError || '') || signUpError?.message || '';

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#050505',
      fontFamily: fInter,
    }}>

      {/* ── Left column — form ──────────────────────────────────────────────── */}
      <div style={{
        flex: '0 0 50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
        className="flex-col w-full md:w-1/2"
      >
        <div style={{ maxWidth: 340, width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 20, fontWeight: 500, color: '#f0f0f0',
              letterSpacing: '-0.02em', marginBottom: 4,
            }}>
              GEOMATIK
            </div>
            <div style={{ fontSize: 12, color: '#666666', fontWeight: 400 }}>
              Geospatial intelligence
            </div>
          </div>

          {/* Section title */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#f0f0f0', marginBottom: 4 }}>
              {mode === 'login' ? 'Connexion' : 'Inscription'}
            </div>
            <div style={{ fontSize: 13, color: '#666666', fontWeight: 400 }}>
              {mode === 'login'
                ? 'Accédez à votre espace de travail'
                : 'Créez votre espace de travail'}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Email */}
            <div>
              <label style={{
                display: 'block', fontSize: 12, color: '#666666', fontWeight: 400, marginBottom: 6,
              }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="nom@entreprise.com"
                required
                autoFocus
                style={{
                  width: '100%', background: '#0a0a0a',
                  border: '0.5px solid #1a1a1a', borderRadius: 6,
                  padding: '9px 12px', fontSize: 13, fontFamily: fInter,
                  color: '#f0f0f0', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#333333'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#1a1a1a'; }}
              />
            </div>

            {/* Password */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: '#666666', fontWeight: 400 }}>
                  Mot de passe
                </label>
                <button
                  type="button"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: '#666666', fontFamily: fInter, padding: 0,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#a0a0a0'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#666666'; }}
                  tabIndex={-1}
                >
                  Mot de passe oublié ?
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  style={{
                    width: '100%', background: '#0a0a0a',
                    border: '0.5px solid #1a1a1a', borderRadius: 6,
                    padding: '9px 36px 9px 12px', fontSize: 13, fontFamily: fInter,
                    color: '#f0f0f0', outline: 'none', boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#333333'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#1a1a1a'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: '#666666', display: 'flex', alignItems: 'center',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#a0a0a0'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#666666'; }}
                  tabIndex={-1}
                >
                  {showPassword
                    ? <EyeOff size={16} />
                    : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                background: 'rgba(255,87,87,0.10)',
                border: '0.5px solid rgba(255,87,87,0.2)',
                borderRadius: 6, padding: '10px 12px',
              }}>
                <AlertCircle size={14} style={{ color: '#ff5757', flexShrink: 0, marginTop: 1 }} />
                <span style={{
                  fontSize: 12, color: '#ff5757', fontFamily: fInter,
                  fontWeight: 400, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                }}>
                  {formatAuthError(
                    error,
                    (signInError as { status?: number } | null)?.status ?? undefined,
                  )}
                </span>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%', padding: '10px 0',
                background: isLoading ? '#262626' : '#f0f0f0',
                color: isLoading ? '#666666' : '#050505',
                border: 'none', borderRadius: 6,
                fontSize: 13, fontWeight: 500, fontFamily: fInter,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = '#d4d4d4'; }}
              onMouseLeave={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = '#f0f0f0'; }}
            >
              {isLoading ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ animation: 'loginSpin 1s linear infinite', flexShrink: 0 }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Connexion...
                </>
              ) : mode === 'login' ? 'Se connecter' : 'Créer un compte'}
            </button>
          </form>

          {/* Signup link */}
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#666666' }}>
            {mode === 'login' ? (
              <span>
                Pas de compte ?{' '}
                <button
                  onClick={() => setMode('signup')}
                  style={{
                    background: 'none', border: 'none', color: '#a0a0a0',
                    cursor: 'pointer', fontSize: 12, fontFamily: fInter,
                    padding: 0, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f0f0f0'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#a0a0a0'; }}
                >
                  Inscription
                </button>
              </span>
            ) : (
              <span>
                Déjà un compte ?{' '}
                <button
                  onClick={() => setMode('login')}
                  style={{
                    background: 'none', border: 'none', color: '#a0a0a0',
                    cursor: 'pointer', fontSize: 12, fontFamily: fInter,
                    padding: 0, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f0f0f0'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#a0a0a0'; }}
                >
                  Connexion
                </button>
              </span>
            )}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 40, borderTop: '0.5px solid #1a1a1a', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3dffa0', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#666666', fontFamily: fMono }}>
                Tous les systèmes opérationnels
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right column — vitrine (hidden on mobile) ───────────────────────── */}
      <div
        className="hidden md:flex"
        style={{
          flex: '0 0 50%',
          background: '#0a0a0a',
          borderLeft: '0.5px solid #1a1a1a',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '40px 24px',
        }}
      >
        {/* Globe SVG — decorative */}
        <div style={{ marginBottom: 24 }}>
          <svg width="200" height="200" viewBox="0 0 200 200" fill="none">
            {/* Concentric circles */}
            <circle cx="100" cy="100" r="40" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.08" />
            <circle cx="100" cy="100" r="60" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.08" />
            <circle cx="100" cy="100" r="80" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.08" />
            {/* Meridian lines */}
            <line x1="100" y1="20" x2="100" y2="180" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.08" />
            <line x1="20" y1="100" x2="180" y2="100" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.08" />
            {/* Diagonal meridians */}
            <line x1="44" y1="44" x2="156" y2="156" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.05" />
            <line x1="156" y1="44" x2="44" y2="156" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.05" />
            {/* Outer ring */}
            <circle cx="100" cy="100" r="90" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.06" />
          </svg>
        </div>

        {/* Copy */}
        <div style={{ textAlign: 'center', maxWidth: 280 }}>
          <div style={{
            fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 10, fontFamily: fInter,
          }}>
            Planification OOH intelligente
          </div>
          <div style={{
            fontSize: 12, color: '#262626', lineHeight: 1.6,
            fontFamily: fInter, fontWeight: 400, maxWidth: 240, margin: '0 auto',
          }}>
            Ciblez, scorez et mesurez vos campagnes d'affichage avec l'IA et la donnée géospatiale.
          </div>
        </div>

        {/* Stats — absolute bottom */}
        <div style={{
          position: 'absolute', bottom: 24, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 24, padding: '0 24px',
        }}>
          {[
            { value: '49K',  label: 'zones IRIS' },
            { value: '3.9K', label: 'panneaux' },
            { value: '285K', label: 'arrêts transport' },
          ].map(stat => (
            <div key={stat.label} style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 16, fontWeight: 500, color: '#333333',
                fontFamily: fMono, letterSpacing: '-0.01em',
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: 10, color: '#262626', fontFamily: fInter, marginTop: 2,
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes loginSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
