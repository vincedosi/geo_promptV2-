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

/** Generate SVG polygon points for a flat-top hexagon */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');
}

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
      background: 'var(--bg-primary)',
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
            <img
              src="/geomatik-logo.svg"
              alt="GEOMATIK"
              width={240}
              style={{ display: 'block' }}
            />
          </div>

          {/* Section title */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
              {mode === 'login' ? 'Connexion' : 'Inscription'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 400 }}>
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
                display: 'block', fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400, marginBottom: 6,
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
                  width: '100%', background: 'var(--bg-level-2)',
                  border: '0.5px solid var(--border-subtle)', borderRadius: 6,
                  padding: '9px 12px', fontSize: 13, fontFamily: fInter,
                  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
              />
            </div>

            {/* Password */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400 }}>
                  Mot de passe
                </label>
                <button
                  type="button"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fInter, padding: 0,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'; }}
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
                    width: '100%', background: 'var(--bg-level-2)',
                    border: '0.5px solid var(--border-subtle)', borderRadius: 6,
                    padding: '9px 36px 9px 12px', fontSize: 13, fontFamily: fInter,
                    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'; }}
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
                <AlertCircle size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                <span style={{
                  fontSize: 12, color: 'var(--danger)', fontFamily: fInter,
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
                background: isLoading ? 'var(--border-default)' : 'var(--text-primary)',
                color: isLoading ? 'var(--text-tertiary)' : 'var(--bg-primary)',
                border: 'none', borderRadius: 6,
                fontSize: 13, fontWeight: 500, fontFamily: fInter,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = '#d4d4d4'; }}
              onMouseLeave={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--text-primary)'; }}
            >
              {isLoading ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Connexion...
                </>
              ) : mode === 'login' ? 'Se connecter' : 'Créer un compte'}
            </button>
          </form>

          {/* Signup link */}
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
            {mode === 'login' ? (
              <span>
                Pas de compte ?{' '}
                <button
                  onClick={() => setMode('signup')}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 12, fontFamily: fInter,
                    padding: 0, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
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
                    background: 'none', border: 'none', color: 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 12, fontFamily: fInter,
                    padding: 0, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                >
                  Connexion
                </button>
              </span>
            )}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 40, borderTop: '0.5px solid var(--border-subtle)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fMono }}>
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
          background: 'var(--bg-surface)',
          borderLeft: '0.5px solid var(--border-subtle)',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '40px 24px',
        }}
      >
        {/* Hexagonal grid — GEOMATIK signature */}
        <div style={{ marginBottom: 32, position: 'relative' }}>
          <svg width="260" height="260" viewBox="0 0 260 260" fill="none" style={{ opacity: 0.9 }}>
            {/* Hexagonal grid pattern */}
            {[
              { x: 130, y: 80 },
              { x: 100, y: 98 }, { x: 160, y: 98 },
              { x: 70, y: 116 }, { x: 130, y: 116 }, { x: 190, y: 116 },
              { x: 100, y: 134 }, { x: 160, y: 134 },
              { x: 70, y: 152 }, { x: 130, y: 152 }, { x: 190, y: 152 },
              { x: 100, y: 170 }, { x: 160, y: 170 },
              { x: 130, y: 188 },
            ].map((pos, i) => {
              const isAccent = [0, 4, 9, 13].includes(i);
              const isMid = [2, 5, 7, 11].includes(i);
              return (
                <g key={i} style={{ animation: `fadeIn 0.4s ease ${i * 0.06}s both` }}>
                  <polygon
                    points={hexPoints(pos.x, pos.y, 14)}
                    fill={isAccent ? 'rgba(78,205,196,0.12)' : 'transparent'}
                    stroke={isAccent ? '#4ecdc4' : isMid ? '#262626' : '#1a1a1a'}
                    strokeWidth="0.5"
                  />
                  {isAccent && (
                    <circle cx={pos.x} cy={pos.y} r="2" fill="#4ecdc4" opacity="0.6" />
                  )}
                </g>
              );
            })}
            {/* Connection lines between accent hexagons */}
            <line x1="130" y1="80" x2="130" y2="116" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.2" />
            <line x1="130" y1="116" x2="130" y2="152" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.2" />
            <line x1="130" y1="152" x2="130" y2="188" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.2" />
          </svg>
        </div>

        {/* Copy */}
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8, fontFamily: fInter,
          }}>
            Intelligence OOH en temps réel
          </div>
          <div style={{
            fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6,
            fontFamily: fInter, fontWeight: 400, maxWidth: 260, margin: '0 auto',
          }}>
            49 000 zones IRIS, 2.3M carreaux INSEE, isochrones multi-modaux — le tout piloté par IA.
          </div>
        </div>

        {/* Stats row — absolute bottom */}
        <div style={{
          position: 'absolute', bottom: 32, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 32, padding: '0 32px',
        }}>
          {[
            { value: '49K',  label: 'zones IRIS' },
            { value: '2.3M', label: 'carreaux' },
            { value: '285K', label: 'arrêts' },
            { value: '3.9K', label: 'panneaux' },
          ].map((stat, i) => (
            <div key={stat.label} style={{ textAlign: 'center', animation: `fadeIn 0.5s ease ${0.3 + i * 0.1}s both` }}>
              <div style={{
                fontSize: 18, fontWeight: 500, color: 'var(--text-primary)',
                fontFamily: fMono, letterSpacing: '-0.02em',
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: 10, color: 'var(--text-tertiary)', fontFamily: fInter, marginTop: 4,
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* loginSpin uses the global 'spin' keyframes from globals.css */}
    </div>
  );
}
