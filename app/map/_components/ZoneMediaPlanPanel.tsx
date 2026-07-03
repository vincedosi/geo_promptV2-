'use client';

/**
 * ZoneMediaPlanPanel — plan média sur les zones custom affichées sur la carte.
 *
 * S'ouvre à droite quand ≥ 1 zone custom est affichée (ZonesOverlay).
 * Paramètres : budget (€), CPM (€), cible (tranche d'âge des audience_stats
 * pré-calculées à la capture — zéro I/O). Une ligne par zone :
 *
 *   Zone · % du total (part de la zone dans la somme des zones, sur la cible)
 *   · % France (vs total national, RPC cachée 24h) · Volume cible
 *   · Impressions (grisé = répartition % × budget/CPM×1000)
 *   · Répartition % (éditable, auto-normalisée à 100)
 *
 * La répartition démarre au prorata du volume cible ; modifier une zone
 * réajuste les autres proportionnellement (somme toujours 100). Le bouton
 * « Au prorata » restaure le défaut. Calculs 100 % client — aucune écriture.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { normalizeShares, proportionalShares } from '@/lib/custom-geo/media-plan';
import type { AudienceStats, CustomGeoZoneFull } from '@/types/custom-geo';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export type CibleKey = 'total' | '0_17' | '18_24' | '25_39' | '40_54' | '55_64' | '65_79' | '80_plus';

const CIBLES: Array<[CibleKey, string]> = [
  ['total', 'Population totale'],
  ['0_17', '0-17 ans'],
  ['18_24', '18-24 ans'],
  ['25_39', '25-39 ans'],
  ['40_54', '40-54 ans'],
  ['55_64', '55-64 ans'],
  ['65_79', '65-79 ans'],
  ['80_plus', '80 ans et plus'],
];

interface ZoneRef { id: string; name: string; }

interface ZoneRow {
  id: string;
  name: string;
  stats: AudienceStats | null;
}

function cibleVolume(stats: AudienceStats | null, cible: CibleKey): number | null {
  if (!stats?.population) return null;
  if (cible === 'total') return stats.population.total ?? null;
  return stats.population.by_age?.[cible] ?? null;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

interface Props {
  zones: ZoneRef[];
  topOffset: number;
  onClose: () => void;
}

export function ZoneMediaPlanPanel({ zones, topOffset, onClose }: Props) {
  const [rows, setRows] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [nationalTotals, setNationalTotals] = useState<Record<string, number> | null>(null);

  const [budget, setBudget] = useState('');
  const [cpm, setCpm] = useState('');
  const [cible, setCible] = useState<CibleKey>('total');
  // Répartition % par zone — null tant que l'utilisateur n'a pas touché
  // (défaut : prorata du volume cible, recalculé quand la cible change)
  const [repartition, setRepartition] = useState<Record<string, number> | null>(null);

  // ── Chargement des stats par zone (audience_stats pré-calculées) ─────────
  useEffect(() => {
    let cancelled = false;
    if (!zones.length) { setRows([]); return; }
    setLoading(true);
    (async () => {
      // Séquentiel par lots de 3 — règle projet : jamais plus de 3 appels parallèles
      const result: ZoneRow[] = [];
      for (let i = 0; i < zones.length; i += 3) {
        const batch = zones.slice(i, i + 3);
        const fetched = await Promise.all(batch.map(async z => {
          try {
            const res = await adminFetch(`/api/custom-geo/${z.id}`);
            if (!res.ok) throw new Error(String(res.status));
            const full = await res.json() as CustomGeoZoneFull;
            const stats = full.audience_stats && 'population' in full.audience_stats
              ? full.audience_stats as AudienceStats
              : null;
            return { id: z.id, name: z.name, stats };
          } catch {
            return { id: z.id, name: z.name, stats: null };
          }
        }));
        result.push(...fetched);
      }
      if (!cancelled) { setRows(result); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [zones]);

  // ── Totaux France (cache serveur 24h + cache navigateur) ─────────────────
  useEffect(() => {
    let cancelled = false;
    adminFetch('/api/custom-geo/national-totals')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled && j?.totals) setNationalTotals(j.totals); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Calculs ───────────────────────────────────────────────────────────────
  const volumes = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of rows) m.set(r.id, cibleVolume(r.stats, cible));
    return m;
  }, [rows, cible]);

  const totalVolume = useMemo(
    () => rows.reduce((acc, r) => acc + (volumes.get(r.id) ?? 0), 0),
    [rows, volumes],
  );

  /** Répartition par défaut : prorata du volume cible (zones sans stats → 0). */
  const defaultRepartition = useMemo(
    () => proportionalShares(rows.map(r => ({ id: r.id, volume: volumes.get(r.id) ?? null }))),
    [rows, volumes],
  );

  const activeRepartition = repartition ?? defaultRepartition;

  // La cible ou la liste de zones change → on repart du prorata
  useEffect(() => { setRepartition(null); }, [cible, zones]);

  /** Modifie la part d'une zone ; les autres se réajustent proportionnellement. */
  const setZoneShare = useCallback((zoneId: string, valueRaw: number) => {
    const current = repartition ?? defaultRepartition;
    setRepartition(normalizeShares(current, zoneId, valueRaw, rows.map(r => r.id)));
  }, [repartition, defaultRepartition, rows]);

  const budgetNum = parseFloat(budget.replace(',', '.'));
  const cpmNum = parseFloat(cpm.replace(',', '.'));
  const totalImpressions = budgetNum > 0 && cpmNum > 0 ? (budgetNum / cpmNum) * 1000 : null;
  const franceTotal = nationalTotals?.[cible] ?? null;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--bg-level-2)',
    border: '0.5px solid var(--border-subtle)', borderRadius: 6,
    fontFamily: fMono, fontSize: 12, color: 'var(--text-primary)', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: fInter, fontSize: 10.5, color: 'var(--text-tertiary)', marginBottom: 4, display: 'block',
  };
  const thStyle: React.CSSProperties = {
    fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)',
    textAlign: 'right', padding: '6px 8px', borderBottom: '0.5px solid var(--border-default)',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    fontFamily: fMono, fontSize: 11.5, color: 'var(--text-secondary)',
    textAlign: 'right', padding: '8px 8px', borderBottom: '0.5px solid var(--border-subtle)',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      position: 'fixed', top: topOffset, right: 0, bottom: 0, width: 500, zIndex: 45,
      background: 'var(--bg-surface)', borderLeft: '0.5px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: fInter }}>
          Plan média — {zones.length} zone{zones.length > 1 ? 's' : ''}
        </span>
        <button onClick={onClose} title="Fermer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 2 }}>
          <X size={15} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Paramètres */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Budget (€)</label>
            <input value={budget} onChange={e => setBudget(e.target.value)} placeholder="50 000" inputMode="decimal" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>CPM (€)</label>
            <input value={cpm} onChange={e => setCpm(e.target.value)} placeholder="6,50" inputMode="decimal" style={inputStyle} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Cible</label>
            <select value={cible} onChange={e => setCible(e.target.value as CibleKey)}
              style={{ ...inputStyle, fontFamily: fInter, cursor: 'pointer' }}>
              {CIBLES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
        </div>

        {/* Impressions totales */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '8px 12px', background: 'var(--bg-level-2)', borderRadius: 6,
          border: '0.5px solid var(--border-subtle)',
        }}>
          <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
            Impressions totales (budget ÷ CPM × 1000)
          </span>
          <span style={{ fontFamily: fMono, fontSize: 14, color: totalImpressions ? 'var(--brand-teal)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
            {totalImpressions ? fmtInt(totalImpressions) : '—'}
          </span>
        </div>

        {/* Tableau */}
        {loading ? (
          <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', padding: '20px 0', textAlign: 'center' }}>
            Chargement des audiences…
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Zone</th>
                  <th style={thStyle} title="Part de la zone dans le total des zones affichées, sur la cible">% zones</th>
                  <th style={thStyle} title="Volume cible de la zone rapporté à la population France de la cible">% France</th>
                  <th style={thStyle}>Volume cible</th>
                  <th style={thStyle} title="Répartition % × impressions totales — calculé, non modifiable">Impressions</th>
                  <th style={thStyle} title="Part du budget allouée à la zone — modifiable, somme = 100 %">Répartition</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const vol = volumes.get(r.id);
                  const share = activeRepartition[r.id] ?? 0;
                  const impressions = totalImpressions != null ? (share / 100) * totalImpressions : null;
                  const pctZones = totalVolume > 0 && vol != null ? (vol / totalVolume) * 100 : null;
                  const pctFrance = franceTotal && vol != null ? (vol / franceTotal) * 100 : null;
                  return (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle, textAlign: 'left', fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>
                        {r.name}
                      </td>
                      <td style={tdStyle}>{pctZones != null ? fmtPct(pctZones) : '—'}</td>
                      <td style={tdStyle}>{pctFrance != null ? fmtPct(pctFrance, 2) : '—'}</td>
                      <td style={tdStyle} title={vol == null ? 'Stats d’audience non calculées pour cette zone' : undefined}>
                        {vol != null ? fmtInt(vol) : 'n/d'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-tertiary)' }}>
                        {impressions != null ? fmtInt(impressions) : '—'}
                      </td>
                      <td style={{ ...tdStyle, padding: '4px 0 4px 8px' }}>
                        <input
                          type="number" min={0} max={100} step={0.1}
                          value={Math.round(share * 10) / 10}
                          onChange={e => setZoneShare(r.id, parseFloat(e.target.value) || 0)}
                          aria-label={`Répartition ${r.name}`}
                          style={{
                            width: 62, padding: '5px 6px', textAlign: 'right',
                            background: 'var(--bg-level-2)', borderRadius: 4,
                            border: `0.5px solid ${repartition ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                            fontFamily: fMono, fontSize: 11.5, color: 'var(--text-primary)', outline: 'none',
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...tdStyle, textAlign: 'left', fontFamily: fInter, color: 'var(--text-tertiary)', borderBottom: 'none' }}>Total</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>{totalVolume > 0 ? '100 %' : '—'}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>
                    {franceTotal && totalVolume > 0 ? fmtPct((totalVolume / franceTotal) * 100, 2) : '—'}
                  </td>
                  <td style={{ ...tdStyle, borderBottom: 'none', color: 'var(--text-primary)' }}>{totalVolume > 0 ? fmtInt(totalVolume) : '—'}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none', color: 'var(--text-primary)' }}>{totalImpressions ? fmtInt(totalImpressions) : '—'}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>
                    {fmtPct(Object.values(activeRepartition).reduce((a, b) => a + b, 0), 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Reset répartition */}
        {repartition && (
          <button
            onClick={() => setRepartition(null)}
            style={{
              alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: '0.5px solid var(--border-default)', borderRadius: 6,
              color: 'var(--text-secondary)', fontFamily: fInter, fontSize: 11, padding: '6px 10px', cursor: 'pointer',
            }}
          >
            <RotateCcw size={11} /> Répartir au prorata de la cible
          </button>
        )}

        <div style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic', lineHeight: 1.5 }}>
          Volumes cibles : carreaux INSEE 200m intersectant la zone (calculés à la capture) ·
          % France : total national carreaux 5 km · les impressions suivent la colonne répartition.
        </div>
      </div>
    </div>
  );
}
