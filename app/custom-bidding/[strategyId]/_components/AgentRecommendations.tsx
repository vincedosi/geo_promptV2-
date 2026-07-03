'use client';

/**
 * AgentRecommendations — liste des recommandations Gemini de la stratégie.
 * Cards avec dot couleur (info/opportunity/warning), titre, body, et boutons
 * Appliquer / Ignorer. Bouton Régénérer en haut.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, Check, X, Sparkles, AlertTriangle, Info, TrendingUp } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Reco {
  id: string;
  strategy_id: string;
  category: string;
  severity: 'info' | 'opportunity' | 'warning';
  title: string;
  body: string;
  proposed_action: Record<string, unknown> | null;
  status: 'pending' | 'applied' | 'ignored' | 'expired';
  generated_at: string;
  model: string | null;
}

interface Props {
  strategyId: string;
  onApplied?: () => void;
}

const SEVERITY_COLOR: Record<Reco['severity'], string> = {
  info: 'var(--info, #5b9bd5)',
  opportunity: 'var(--brand-teal)',
  warning: 'var(--warning)',
};

const SEVERITY_ICON: Record<Reco['severity'], typeof Info> = {
  info: Info,
  opportunity: TrendingUp,
  warning: AlertTriangle,
};

const CATEGORY_LABEL: Record<string, string> = {
  curve_tuning: 'Courbe',
  zone_focus: 'Zone',
  budget: 'Budget',
  frequency: 'Fréquence',
  target_alignment: 'Cible',
  other: 'Autre',
};

export function AgentRecommendations({ strategyId, onApplied }: Props) {
  const [recos, setRecos] = useState<Reco[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/recommendations?status=pending`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecos((data.recommendations ?? []) as Reco[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/recommendations`, {
        method: 'POST',
        cache: 'no-store',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const apply = async (recoId: string) => {
    setBusyId(recoId);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/recommendations/${recoId}/apply`, {
        method: 'POST', cache: 'no-store',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onApplied?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const ignore = async (recoId: string) => {
    setBusyId(recoId);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/recommendations/${recoId}/ignore`, {
        method: 'POST', cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: 12, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Sparkles size={12} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 11, fontWeight: 500 }}>Recommandations agent IA</span>
        {recos && (
          <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            ({recos.length} en attente)
          </span>
        )}
        <button
          type="button"
          onClick={() => { void generate(); }}
          disabled={generating || loading}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
            background: generating ? 'var(--bg-level-2)' : 'var(--brand-teal)',
            color: generating ? 'var(--text-tertiary)' : 'var(--bg-level-0)',
            border: '0.5px solid var(--brand-teal)',
            borderRadius: 5, cursor: generating ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={11} strokeWidth={1.8} className={generating ? 'agent-spin' : undefined} />
          {generating ? 'Analyse en cours…' : 'Analyser maintenant'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '6px 10px',
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--danger)',
          borderRadius: 5,
          fontSize: 11, fontFamily: fMono, color: 'var(--danger)',
          marginBottom: 8,
        }}>
          {error}
        </div>
      )}

      {loading && !recos && (
        <div style={{ fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)', padding: 8 }}>
          Chargement…
        </div>
      )}

      {recos && recos.length === 0 && !generating && (
        <div style={{
          padding: 16, textAlign: 'center',
          fontSize: 11, fontFamily: fInter, color: 'var(--text-tertiary)',
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 8,
        }}>
          Aucune recommandation pour le moment. Clique sur <strong style={{ color: 'var(--brand-teal)' }}>Analyser maintenant</strong> pour que l&apos;agent étudie ta stratégie.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(recos ?? []).map(r => {
          const Icon = SEVERITY_ICON[r.severity];
          const color = SEVERITY_COLOR[r.severity];
          const busy = busyId === r.id;
          return (
            <div
              key={r.id}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-level-2)',
                border: `0.5px solid ${color}`,
                borderLeft: `2px solid ${color}`,
                borderRadius: 6,
                opacity: busy ? 0.5 : 1,
                transition: 'opacity 200ms',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Icon size={13} strokeWidth={1.8} color={color} />
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {r.title}
                </span>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)',
                  padding: '2px 6px',
                  background: 'var(--bg-level-1)',
                  border: '0.5px solid var(--border-subtle)',
                  borderRadius: 3,
                }}>
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </span>
              </div>
              <div style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
                {r.body}
              </div>
              {r.proposed_action && (
                <div style={{
                  fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)',
                  padding: '4px 8px',
                  background: 'var(--bg-level-1)',
                  border: '0.5px solid var(--border-subtle)',
                  borderRadius: 4,
                  marginBottom: 8,
                }}>
                  Action proposée : <span style={{ color: 'var(--text-secondary)' }}>{(r.proposed_action.type as string) ?? 'inconnue'}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { void ignore(r.id); }}
                  disabled={busy}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '5px 10px', fontSize: 10, fontFamily: fInter, fontWeight: 500,
                    background: 'transparent', color: 'var(--text-tertiary)',
                    border: '0.5px solid var(--border-subtle)',
                    borderRadius: 5, cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  <X size={10} /> Ignorer
                </button>
                {r.proposed_action && (r.proposed_action.type as string) !== 'no_action' && (
                  <button
                    type="button"
                    onClick={() => { void apply(r.id); }}
                    disabled={busy}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '5px 10px', fontSize: 10, fontFamily: fInter, fontWeight: 500,
                      background: 'var(--brand-teal)', color: 'var(--bg-level-0)',
                      border: '0.5px solid var(--brand-teal)',
                      borderRadius: 5, cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <Check size={10} /> Appliquer
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .agent-spin { animation: agentSpin 1s linear infinite; }
        @keyframes agentSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
