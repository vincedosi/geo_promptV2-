'use client';

/**
 * AgentDrifts — liste les drift events détectés sur la stratégie + bouton
 * de détection locale (Page-Hinkley côté Node) en complément du service ML.
 */
import { useEffect, useState } from 'react';
import { Activity, RefreshCw, AlertTriangle } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface DriftEvent {
  id: string;
  strategy_id: string;
  postal_code: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detected_at: string;
  details: Record<string, unknown> | null;
}

const SEV_COLOR: Record<DriftEvent['severity'], string> = {
  low: 'var(--text-tertiary)',
  medium: 'var(--info, #5b9bd5)',
  high: 'var(--warning)',
  critical: 'var(--danger)',
};

interface Props {
  strategyId: string;
  onApplied?: () => void;
}

export function AgentDrifts({ strategyId }: Props) {
  const [events, setEvents] = useState<DriftEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/drift-events`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents((data.events ?? []) as DriftEvent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const detect = async () => {
    setDetecting(true);
    setError(null);
    setInfo(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/drift-detect-local`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookback_days: 14, metric: 'impressions' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      setInfo(`Page-Hinkley : ${result.n_candidates} drifts détectés sur ${result.lookback_days} jours, ${result.n_persisted} persistés.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div style={{ padding: 12, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Activity size={12} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 11, fontWeight: 500 }}>Drift events</span>
        {events && (
          <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            ({events.length} détectés)
          </span>
        )}
        <button
          type="button"
          onClick={() => { void detect(); }}
          disabled={detecting || loading}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
            background: detecting ? 'var(--bg-level-2)' : 'var(--brand-teal)',
            color: detecting ? 'var(--text-tertiary)' : 'var(--bg-level-0)',
            border: '0.5px solid var(--brand-teal)',
            borderRadius: 5, cursor: detecting ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={11} strokeWidth={1.8} className={detecting ? 'agent-spin' : undefined} />
          {detecting ? 'Détection…' : 'Détecter (Page-Hinkley)'}
        </button>
      </div>

      {info && (
        <div style={{
          padding: '6px 10px', marginBottom: 8,
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--brand-teal)',
          borderRadius: 5,
          fontSize: 11, fontFamily: fMono, color: 'var(--brand-teal)',
        }}>{info}</div>
      )}

      {error && (
        <div style={{
          padding: '6px 10px', marginBottom: 8,
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--danger)',
          borderRadius: 5,
          fontSize: 11, fontFamily: fMono, color: 'var(--danger)',
        }}>{error}</div>
      )}

      {events && events.length === 0 && !detecting && (
        <div style={{
          padding: 16, textAlign: 'center',
          fontSize: 11, fontFamily: fInter, color: 'var(--text-tertiary)',
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 8,
        }}>
          Aucun drift détecté. La stratégie suit le modèle de simulation.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(events ?? []).map(e => {
          const color = SEV_COLOR[e.severity];
          const date = new Date(e.detected_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
          const phValue = (e.details as { ph_value?: number })?.ph_value;
          return (
            <div
              key={e.id}
              style={{
                padding: '8px 10px',
                background: 'var(--bg-level-2)',
                border: `0.5px solid ${color}`,
                borderLeft: `2px solid ${color}`,
                borderRadius: 5,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <AlertTriangle size={12} color={color} strokeWidth={1.8} />
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                {e.postal_code ? `CP ${e.postal_code}` : 'Stratégie globale'}
              </span>
              <span style={{ fontSize: 10, fontFamily: fMono, color, textTransform: 'uppercase' }}>
                {e.severity}
              </span>
              {phValue !== undefined && (
                <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
                  PH={phValue.toFixed(2)}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
                {date}
              </span>
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
