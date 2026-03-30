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
      overflow: 'hidden',
    }}>

      {/* ── Left column — form ──────────────────────────────────────────────── */}
      <div style={{
        flex: '1 1 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        position: 'relative',
        minHeight: '100vh',
      }}
        className="w-full md:w-[45%] md:flex-none"
      >
        {/* Subtle hex grid background — left panel */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66ZM28 100L0 84L0 50L28 34L56 50L56 84L28 100Z' fill='none' stroke='%23f0f0f0' stroke-width='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: '42px 75px',
        }} />

        <div style={{
          maxWidth: 360, width: '100%', position: 'relative', zIndex: 1,
        }}>

          {/* Logo with entrance animation */}
          <div style={{
            marginBottom: 48,
            animation: 'loginFadeUp 0.6s ease-out both',
          }}>
            <img
              src="/geomatik-logo.svg"
              alt="GEOMATIK"
              width={220}
              style={{ display: 'block' }}
            />
          </div>

          {/* Section title */}
          <div style={{
            marginBottom: 32,
            animation: 'loginFadeUp 0.6s ease-out 0.1s both',
          }}>
            <div style={{
              fontSize: 20, fontWeight: 500, color: '#f0f0f0',
              marginBottom: 8, letterSpacing: '-0.02em',
            }}>
              {mode === 'login' ? 'Connexion' : 'Inscription'}
            </div>
            <div style={{ fontSize: 13, color: '#666666', fontWeight: 400, lineHeight: 1.6 }}>
              {mode === 'login'
                ? 'Accédez à votre espace géomarketing'
                : 'Créez votre espace géomarketing'}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{
            display: 'flex', flexDirection: 'column', gap: 20,
            animation: 'loginFadeUp 0.6s ease-out 0.2s both',
          }}>

            {/* Email */}
            <div>
              <label style={{
                display: 'block', fontSize: 12, color: '#666666',
                fontWeight: 400, marginBottom: 8, letterSpacing: '0.02em',
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
                  padding: '11px 14px', fontSize: 13, fontFamily: fInter,
                  color: '#f0f0f0', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#1a1a1a'; }}
              />
            </div>

            {/* Password */}
            <div>
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', marginBottom: 8,
              }}>
                <label style={{
                  fontSize: 12, color: '#666666', fontWeight: 400,
                  letterSpacing: '0.02em',
                }}>
                  Mot de passe
                </label>
                <button
                  type="button"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: '#666666', fontFamily: fInter, padding: 0,
                    transition: 'color 0.2s ease',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#4ecdc4'; }}
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
                    padding: '11px 40px 11px 14px', fontSize: 13, fontFamily: fInter,
                    color: '#f0f0f0', outline: 'none', boxSizing: 'border-box',
                    transition: 'border-color 0.2s ease',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#1a1a1a'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: '#666666', display: 'flex', alignItems: 'center',
                    transition: 'color 0.2s ease',
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
                animation: 'loginShake 0.4s ease-out',
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
                width: '100%', padding: '12px 0',
                background: isLoading ? '#262626' : '#f0f0f0',
                color: isLoading ? '#666666' : '#050505',
                border: 'none', borderRadius: 6,
                fontSize: 13, fontWeight: 500, fontFamily: fInter,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.2s ease, color 0.2s ease, transform 0.1s ease',
                marginTop: 4,
                letterSpacing: '-0.01em',
              }}
              onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = '#d4d4d4'; }}
              onMouseLeave={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = '#f0f0f0'; }}
              onMouseDown={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.985)'; }}
              onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
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
          <div style={{
            textAlign: 'center', marginTop: 20, fontSize: 12, color: '#666666',
            animation: 'loginFadeUp 0.6s ease-out 0.35s both',
          }}>
            {mode === 'login' ? (
              <span>
                Pas de compte ?{' '}
                <button
                  onClick={() => setMode('signup')}
                  style={{
                    background: 'none', border: 'none', color: '#4ecdc4',
                    cursor: 'pointer', fontSize: 12, fontFamily: fInter,
                    padding: 0, transition: 'color 0.2s ease',
                    fontWeight: 500,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#3dbdb5'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#4ecdc4'; }}
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
                    background: 'none', border: 'none', color: '#4ecdc4',
                    cursor: 'pointer', fontSize: 12, fontFamily: fInter,
                    padding: 0, transition: 'color 0.2s ease',
                    fontWeight: 500,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#3dbdb5'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#4ecdc4'; }}
                >
                  Connexion
                </button>
              </span>
            )}
          </div>

          {/* Footer */}
          <div style={{
            marginTop: 48, borderTop: '1px solid #1a1a1a', paddingTop: 16,
            animation: 'loginFadeUp 0.6s ease-out 0.45s both',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#3dffa0', flexShrink: 0,
                animation: 'loginPulse 3s ease-in-out infinite',
              }} />
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
          flex: '0 0 55%',
          background: '#0a0a0a',
          borderLeft: '0.5px solid #1a1a1a',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '40px 32px',
          overflow: 'hidden',
        }}
      >
        {/* Hex grid background — right panel */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.025, pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66ZM28 100L0 84L0 50L28 34L56 50L56 84L28 100Z' fill='none' stroke='%234ecdc4' stroke-width='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: '42px 75px',
        }} />

        {/* Crosshair lines — decorative */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: '0.5px', background: '#1a1a1a', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: '50%', top: 0, bottom: 0,
          width: '0.5px', background: '#1a1a1a', pointerEvents: 'none',
        }} />

        {/* Globe SVG — animated orbital */}
        <div style={{
          marginBottom: 40, position: 'relative',
          animation: 'loginFadeUp 0.8s ease-out 0.3s both',
        }}>
          <svg width="240" height="240" viewBox="0 0 240 240" fill="none"
            style={{ display: 'block' }}
          >
            {/* Outer ring with dashes */}
            <circle cx="120" cy="120" r="110" stroke="#262626" strokeWidth="0.5"
              strokeDasharray="4 8" style={{ animation: 'loginOrbitSlow 60s linear infinite' }}
              transform-origin="120 120" />

            {/* Concentric rings */}
            <circle cx="120" cy="120" r="90" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.08" />
            <circle cx="120" cy="120" r="65" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.1" />
            <circle cx="120" cy="120" r="40" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.12" />

            {/* Meridian arcs — globe feel */}
            <ellipse cx="120" cy="120" rx="25" ry="65" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.07"
              transform="rotate(0 120 120)" />
            <ellipse cx="120" cy="120" rx="50" ry="65" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.07"
              transform="rotate(0 120 120)" />
            <ellipse cx="120" cy="120" rx="65" ry="35" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.07"
              transform="rotate(0 120 120)" />

            {/* Axis lines */}
            <line x1="120" y1="30" x2="120" y2="210" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.06" />
            <line x1="30" y1="120" x2="210" y2="120" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.06" />
            <line x1="50" y1="50" x2="190" y2="190" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.04" />
            <line x1="190" y1="50" x2="50" y2="190" stroke="#f0f0f0" strokeWidth="0.5" opacity="0.04" />

            {/* Orbiting ring — teal */}
            <circle cx="120" cy="120" r="80" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.15"
              strokeDasharray="2 12"
              style={{ animation: 'loginOrbit 20s linear infinite', transformOrigin: '120px 120px' }} />

            {/* Data nodes — static points on the grid */}
            <circle cx="120" cy="55" r="2" fill="#4ecdc4" opacity="0.6" />
            <circle cx="175" cy="95" r="1.5" fill="#f0f0f0" opacity="0.3" />
            <circle cx="160" cy="155" r="2" fill="#4ecdc4" opacity="0.4" />
            <circle cx="80" cy="145" r="1.5" fill="#f0f0f0" opacity="0.3" />
            <circle cx="65" cy="90" r="2" fill="#4ecdc4" opacity="0.5" />
            <circle cx="120" cy="120" r="3" fill="#4ecdc4" opacity="0.8" />

            {/* Connection lines from center */}
            <line x1="120" y1="120" x2="120" y2="55" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.15" />
            <line x1="120" y1="120" x2="175" y2="95" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.1" />
            <line x1="120" y1="120" x2="160" y2="155" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.1" />
            <line x1="120" y1="120" x2="80" y2="145" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.1" />
            <line x1="120" y1="120" x2="65" y2="90" stroke="#4ecdc4" strokeWidth="0.5" opacity="0.1" />

            {/* Orbiting dot */}
            <circle r="3" fill="#4ecdc4" opacity="0.7"
              style={{ animation: 'loginDotOrbit 12s linear infinite', offsetPath: 'circle(80px at 120px 120px)' }} />

            {/* Second orbiting dot — opposite direction */}
            <circle r="2" fill="#f0f0f0" opacity="0.4"
              style={{ animation: 'loginDotOrbit2 18s linear infinite', offsetPath: 'circle(65px at 120px 120px)' }} />
          </svg>
        </div>

        {/* Copy block */}
        <div style={{
          textAlign: 'center', maxWidth: 320, position: 'relative', zIndex: 1,
          animation: 'loginFadeUp 0.8s ease-out 0.5s both',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, marginBottom: 16,
          }}>
            <div style={{ width: 24, height: '0.5px', background: '#262626' }} />
            <span style={{
              fontSize: 10, fontFamily: fMono, color: '#4ecdc4',
              letterSpacing: '0.1em',
            }}>
              GEOMATIK
            </span>
            <div style={{ width: 24, height: '0.5px', background: '#262626' }} />
          </div>
          <div style={{
            fontSize: 18, fontWeight: 500, color: '#f0f0f0', marginBottom: 12,
            fontFamily: fInter, letterSpacing: '-0.02em', lineHeight: 1.4,
          }}>
            Planification OOH intelligente
          </div>
          <div style={{
            fontSize: 13, color: '#666666', lineHeight: 1.7,
            fontFamily: fInter, fontWeight: 400, maxWidth: 280, margin: '0 auto',
          }}>
            Ciblez, scorez et mesurez vos campagnes d&apos;affichage extérieur avec l&apos;IA et les données géospatiales INSEE.
          </div>
        </div>

        {/* Stats row — positioned at bottom */}
        <div style={{
          position: 'absolute', bottom: 32, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 0,
          padding: '0 32px',
          animation: 'loginFadeUp 0.8s ease-out 0.7s both',
        }}>
          {[
            { value: '49K',  label: 'zones IRIS',       delay: '0.8s' },
            { value: '3.9K', label: 'panneaux OOH',     delay: '0.9s' },
            { value: '285K', label: 'arrêts transport',  delay: '1.0s' },
          ].map((stat, i) => (
            <div key={stat.label} style={{
              textAlign: 'center', flex: 1, position: 'relative',
              padding: '16px 0',
              animation: `loginFadeUp 0.6s ease-out ${stat.delay} both`,
            }}>
              {/* Separator between stats */}
              {i > 0 && (
                <div style={{
                  position: 'absolute', left: 0, top: '20%', bottom: '20%',
                  width: '0.5px', background: '#1a1a1a',
                }} />
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{
                  width: 4, height: 4, borderRadius: '50%', background: '#4ecdc4',
                  opacity: 0.6, flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 18, fontWeight: 500, color: '#f0f0f0',
                  fontFamily: fMono, letterSpacing: '-0.02em',
                }}>
                  {stat.value}
                </span>
              </div>
              <div style={{
                fontSize: 11, color: '#666666', fontFamily: fInter,
                fontWeight: 400,
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Top-right corner decoration */}
        <div style={{
          position: 'absolute', top: 24, right: 24,
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'loginFadeUp 0.6s ease-out 0.6s both',
        }}>
          <span style={{
            fontSize: 10, fontFamily: fMono, color: '#333333',
            letterSpacing: '0.05em',
          }}>
            v7.x
          </span>
          <div style={{
            width: 16, height: '0.5px', background: '#262626',
          }} />
          <span style={{
            fontSize: 10, fontFamily: fMono, color: '#333333',
          }}>
            SaaS B2B
          </span>
        </div>

        {/* Bottom-left corner — coordinates */}
        <div style={{
          position: 'absolute', bottom: 100, left: 32,
          animation: 'loginFadeUp 0.6s ease-out 0.9s both',
        }}>
          <span style={{
            fontSize: 10, fontFamily: fMono, color: '#262626',
            letterSpacing: '0.02em',
          }}>
            48.8566°N 2.3522°E
          </span>
        </div>
      </div>

      <style>{`
        @keyframes loginSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes loginFadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes loginOrbit {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes loginOrbitSlow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes loginPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
        @keyframes loginDotOrbit {
          from { offset-distance: 0%; }
          to   { offset-distance: 100%; }
        }
        @keyframes loginDotOrbit2 {
          from { offset-distance: 50%; }
          to   { offset-distance: 150%; }
        }
        @keyframes loginShake {
          0%  { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(2px); }
          100%{ transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
