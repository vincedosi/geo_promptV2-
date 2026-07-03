'use client';

/**
 * /settings/agent — page de configuration globale de GeoAgent.
 * Permet de choisir le niveau d'autonomie par défaut (user_default).
 * L'override par stratégie se fait sur la page /custom-bidding/[id] (cf phase 6.2).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, Bell, Lightbulb, Zap, Bot, Sparkles, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import type { AutonomyLevel } from '@/lib/agent/types';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface LevelOption {
  level: AutonomyLevel;
  name: string;
  description: string;
  Icon: typeof Eye;
  color: string;
}

const LEVELS: LevelOption[] = [
  { level: 0, name: 'Observer', description: "L'agent ne fait rien tout seul. Il répond uniquement quand vous le sollicitez.", Icon: Eye, color: '#a0a0a0' },
  { level: 1, name: 'Explainer', description: "L'agent peut envoyer des notifications proactives mais ne prend aucune action.", Icon: Bell, color: '#5b9bd5' },
  { level: 2, name: 'Suggester', description: "L'agent propose des actions concrètes. Vous validez chacune avant exécution.", Icon: Lightbulb, color: '#f7b731' },
  { level: 3, name: 'Auto low-risk', description: "L'agent agit seul sur les actions à faible risque (logs, alertes, ré-entraînement). Validation requise pour le reste.", Icon: Zap, color: '#ff8a4c' },
  { level: 4, name: 'Full auto', description: "L'agent agit seul sur toutes les actions, y compris haut risque. À utiliser avec précaution.", Icon: Bot, color: '#3dffa0' },
];

export default function AgentSettingsPage() {
  const [current, setCurrent] = useState<AutonomyLevel | null>(null);
  const [saving, setSaving] = useState<AutonomyLevel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch('/api/agent/settings', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { settings: { autonomy_level: 2 } })
      .then(d => setCurrent((d.settings?.autonomy_level ?? 2) as AutonomyLevel))
      .catch(e => setError(String(e)));
  }, []);

  const update = async (level: AutonomyLevel) => {
    if (level === current) return;
    setSaving(level);
    setError(null);
    try {
      const res = await adminFetch('/api/agent/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomy_level: level }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setCurrent(level);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', padding: '32px 40px', fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <header style={{ marginBottom: 28 }}>
          <Link href="/" style={{ fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)', textDecoration: 'none' }}>
            ← retour
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <Sparkles size={20} style={{ color: 'var(--brand-teal)' }} />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>
              GeoAgent — paramètres
            </h1>
          </div>
          <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            Choisissez le niveau d&apos;autonomie par défaut de l&apos;agent IA. Ce paramètre s&apos;applique à toutes vos stratégies sauf override spécifique.
          </p>
        </header>

        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, fontSize: 12, fontFamily: fMono, background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.3)', borderRadius: 6, color: '#ff5757' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {LEVELS.map(opt => {
            const active = current === opt.level;
            const isSaving = saving === opt.level;
            return (
              <button
                key={opt.level}
                onClick={() => update(opt.level)}
                disabled={saving !== null}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  padding: '16px 18px',
                  background: active ? 'rgba(78,205,196,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `0.5px solid ${active ? 'var(--brand-teal)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 10, textAlign: 'left',
                  cursor: saving !== null ? 'wait' : 'pointer',
                  transition: 'border-color 120ms, background 120ms',
                  opacity: saving !== null && !isSaving ? 0.6 : 1,
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 40, height: 40, borderRadius: 10,
                    background: `${opt.color}15`,
                    border: `0.5px solid ${opt.color}50`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: opt.color,
                  }}
                >
                  {isSaving ? <Loader2 size={18} className="anim-spin" /> : <opt.Icon size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {opt.name}
                    </span>
                    <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
                      L{opt.level}
                    </span>
                    {active && (
                      <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--brand-teal)', marginLeft: 'auto' }}>
                        ● actif
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {opt.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 28, padding: '14px 18px', background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)', borderRadius: 8, fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          Override par stratégie : disponible directement dans l&apos;en-tête de chaque page <code style={{ color: 'var(--brand-teal)' }}>/custom-bidding/[strategyId]</code> (à venir phase 6.2).
        </div>
      </div>
      <style>{`
        .anim-spin { animation: agentspin 0.9s linear infinite; }
        @keyframes agentspin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
