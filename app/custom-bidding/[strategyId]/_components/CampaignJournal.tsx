'use client';

/**
 * CampaignJournal — frise verticale type "git log" qui agrège
 * tous les événements ML de la campagne (actions, drifts, recos)
 * jour par jour avec filtres et icônes sémantiques.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollText, Activity, Sparkles, Wrench, Settings, Flag, RefreshCw, Brain } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Event {
  at: string;
  type: 'action' | 'drift' | 'recommendation';
  subtype: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | 'opportunity' | 'warning';
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
}

interface DayEntry {
  date: string;
  events: Event[];
}

const SEV_COLOR: Record<Event['severity'], string> = {
  info: 'var(--text-tertiary)',
  low: 'var(--text-tertiary)',
  medium: 'var(--info, #5b9bd5)',
  high: 'var(--warning)',
  critical: 'var(--danger)',
  opportunity: 'var(--brand-teal)',
  warning: 'var(--warning)',
};

const TYPE_ICON: Record<string, typeof Activity> = {
  action: Brain,
  drift: Activity,
  recommendation: Sparkles,
};

const SUBTYPE_ICON: Record<string, typeof Wrench> = {
  init: Flag,
  train: Brain,
  predict: Brain,
  curve_change: Wrench,
  mode_change: Settings,
  end_of_campaign: Flag,
  recommendation: Sparkles,
  drift_analysis: Activity,
};

const FILTERS: { key: string; label: string; types?: string[]; subtypes?: string[] }[] = [
  { key: 'all',     label: 'Tous' },
  { key: 'drifts',  label: 'Drifts',     types: ['drift'] },
  { key: 'recos',   label: 'Recos',      types: ['recommendation'] },
  { key: 'curve',   label: 'Courbe',     subtypes: ['curve_change'] },
  { key: 'train',   label: 'Trains',     subtypes: ['train', 'predict'] },
];

interface Props {
  strategyId: string;
}

export function CampaignJournal({ strategyId }: Props) {
  const [entries, setEntries] = useState<DayEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/journal`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries((data.entries ?? []) as DayEntry[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredEntries = useMemo(() => {
    if (!entries) return null;
    const f = FILTERS.find(x => x.key === filter);
    if (!f || filter === 'all') return entries;
    return entries
      .map(d => ({
        ...d,
        events: d.events.filter(e =>
          (f.types && f.types.includes(e.type)) ||
          (f.subtypes && f.subtypes.includes(e.subtype)),
        ),
      }))
      .filter(d => d.events.length > 0);
  }, [entries, filter]);

  return (
    <div style={{ padding: 12, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <ScrollText size={12} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 11, fontWeight: 500 }}>Journal de campagne</span>
        {entries && (
          <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            ({entries.reduce((s, d) => s + d.events.length, 0)} événements · {entries.length} jours)
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2, padding: 2, background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 5 }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                padding: '4px 9px', fontSize: 10, fontFamily: fInter, fontWeight: 500,
                background: filter === f.key ? 'var(--brand-teal)' : 'transparent',
                color: filter === f.key ? 'var(--bg-level-0)' : 'var(--text-secondary)',
                border: 'none', borderRadius: 3, cursor: 'pointer',
              }}
            >{f.label}</button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { void load(); }}
          disabled={loading}
          style={{
            padding: '4px 8px', fontSize: 10, fontFamily: fMono,
            background: 'transparent', color: 'var(--text-tertiary)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 4, cursor: 'pointer',
          }}
        ><RefreshCw size={10} className={loading ? 'agent-spin' : undefined} /></button>
      </div>

      {error && (
        <div style={{ padding: '6px 10px', background: 'var(--bg-level-2)', border: '0.5px solid var(--danger)', borderRadius: 5, fontSize: 11, fontFamily: fMono, color: 'var(--danger)', marginBottom: 8 }}>
          {error}
        </div>
      )}

      {filteredEntries && filteredEntries.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 11, fontFamily: fInter, color: 'var(--text-tertiary)', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8 }}>
          Aucun événement pour ce filtre.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
        {/* Ligne verticale de la timeline */}
        <div style={{
          position: 'absolute', left: 14, top: 12, bottom: 0,
          width: 1, background: 'var(--border-subtle)',
        }} />

        {(filteredEntries ?? []).map(d => (
          <div key={d.date} style={{ marginBottom: 10 }}>
            <div style={{
              padding: '4px 10px', marginLeft: 28, marginBottom: 4,
              fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)',
              fontWeight: 500, letterSpacing: '0.04em',
            }}>
              {new Date(d.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </div>
            {d.events.map((e, idx) => {
              const TypeIcon = SUBTYPE_ICON[e.subtype] ?? TYPE_ICON[e.type] ?? Brain;
              const color = SEV_COLOR[e.severity];
              const time = new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={idx} style={{ position: 'relative', marginBottom: 4 }}>
                  {/* Pastille sur la timeline */}
                  <div style={{
                    position: 'absolute', left: 8, top: 6,
                    width: 14, height: 14, borderRadius: '50%',
                    background: 'var(--bg-level-1)',
                    border: `2px solid ${color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <TypeIcon size={7} color={color} strokeWidth={2.4} />
                  </div>
                  <div style={{
                    marginLeft: 32,
                    padding: '6px 10px',
                    background: 'var(--bg-level-2)',
                    border: '0.5px solid var(--border-subtle)',
                    borderLeft: `2px solid ${color}`,
                    borderRadius: 4,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', minWidth: 38 }}>{time}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
                        {e.title}
                      </span>
                      <span style={{
                        fontSize: 9, fontFamily: fMono, color, padding: '1px 6px',
                        background: 'var(--bg-level-1)', border: `0.5px solid ${color}`, borderRadius: 3,
                      }}>
                        {e.type}
                      </span>
                    </div>
                    {e.body && (
                      <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5, paddingLeft: 46 }}>
                        {e.body}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <style>{`
        .agent-spin { animation: agentSpin 1s linear infinite; }
        @keyframes agentSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
