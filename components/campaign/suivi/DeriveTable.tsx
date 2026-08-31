'use client';

/**
 * DeriveTable — tableau classé des zones qui dérivent, à côté/sous
 * `SuiviDeriveMap` (Task 7 du plan carte de dérive, sql/117-118).
 *
 * Fetch `GET /derive/ranked` débouncé n'est pas nécessaire ici (un seul appel
 * par changement de maille/métrique/acteurs, pas de saisie libre) mais reste
 * CACHÉ par `campaignId|mesh|metric|actorsKey(actors)` dans un `useRef(Map)`,
 * `AbortController` sur changement — mêmes règles Nano que `SuiviDeriveMap`.
 * Le CURSEUR DE SEUIL recolore le badge/la mini-barre côté client
 * (`decrocheTone`) SANS refetch : `threshold` n'est jamais une dépendance de
 * l'effet de fetch. L'ordre pire-d'abord vient du serveur (RPC
 * `get_campaign_derive_ranked`) — jamais retrié côté client.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { fmtInt } from '@/lib/campaigns/suivi-metrics';
import {
  actorsKey, decrocheTone,
  type DeriveMesh, type DeriveMetric, type DeriveRow, type DeriveTone,
} from '@/lib/campaigns/derive-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const cellStyle = {
  padding: '7px 10px', fontFamily: fMono, fontSize: 11.5,
  color: 'var(--text-secondary)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const,
};
const headStyle = {
  padding: '7px 10px', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase' as const,
  letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'right' as const,
};

/** Couleur de ton pour le badge/la mini-barre du score de dérive. `toneColor`
 *  (suivi-metrics) ne connaît que ok/warn/bad — la carte de dérive ajoute
 *  `over` (> 110 %, surperformance) qu'on mappe ici au teal de marque, comme
 *  `readTones().teal` dans `SuiviDeriveMap`. Tokens uniquement. */
function deriveToneColor(tone: DeriveTone): string {
  if (tone === 'bad') return 'var(--danger)';
  if (tone === 'warn') return 'var(--warning)';
  if (tone === 'ok') return 'var(--success)';
  return 'var(--brand-teal)';
}

/** Mailles supportées par la route `/derive/ranked` (le national n'a pas de
 *  granularité dédiée côté RPC) — même résolution que `SuiviDeriveMap`. */
type FetchMesh = 'region' | 'departement' | 'cp';

interface RankedResponse { rows: DeriveRow[] }

export function DeriveTable({
  campaignId, mesh, metric, actors, threshold, onRowClick,
}: {
  campaignId: string;
  mesh: DeriveMesh;
  metric: DeriveMetric;
  actors: string[];
  threshold: number;
  onRowClick: (code: string) => void;
}) {
  const [rows, setRows] = useState<DeriveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, DeriveRow[]>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const actorsK = actorsKey(actors);
  const fetchMesh: FetchMesh = mesh === 'national' ? 'region' : mesh;

  // Fetch caché — mesh/metric/actors seulement (JAMAIS le seuil, cf. en-tête).
  useEffect(() => {
    const key = `${campaignId}|${fetchMesh}|${metric}|${actorsK}`;
    const cached = cacheRef.current.get(key);
    if (cached) { setRows(cached); return; }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    const actorsQ = actors.length ? `&actors=${encodeURIComponent(actors.join(','))}` : '';
    adminFetch(
      `/api/digital/${campaignId}/derive/ranked?mesh=${fetchMesh}&metric=${metric}${actorsQ}`,
      { cache: 'no-store', signal: ac.signal },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((d: RankedResponse | null) => {
        if (ac.signal.aborted || !d) return;
        const r = d.rows ?? [];
        cacheRef.current.set(key, r);
        setRows(r);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') {
          // Réseau instable : le tableau garde le dernier état rendu, pas de crash.
        }
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });

    return () => { ac.abort(); };
    // threshold volontairement absent des deps : le badge recolore sans refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, fetchMesh, metric, actorsK]);

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px' }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          Zones en dérive — triées du pire indice au meilleur
        </span>
        {loading && (
          <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>chargement…</span>
        )}
      </div>

      <div style={{
        overflowX: 'auto', overflowY: 'auto', maxHeight: 320,
        border: '0.5px solid var(--border-subtle)', borderRadius: 8,
      }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ ...headStyle, textAlign: 'left' }}>Zone</th>
              <th style={headStyle}>Livré</th>
              <th style={headStyle}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = decrocheTone(row.value, threshold);
              const color = deriveToneColor(tone);
              const barPct = row.value != null ? Math.max(0, Math.min(100, row.value)) : 0;
              return (
                <tr
                  key={row.code}
                  onClick={() => onRowClick(row.code)}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                >
                  <td style={{ ...cellStyle, textAlign: 'left', fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)' }}>
                    {row.code}
                    {row.nom && (
                      <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 11 }}>{row.nom}</span>
                    )}
                    {row.in_target && (
                      <span style={{
                        marginLeft: 8, fontFamily: fInter, fontSize: 9, color: 'var(--brand-teal)',
                        border: '0.5px solid var(--brand-teal-30)', borderRadius: 4, padding: '1px 5px',
                      }}
                      >
                        cible
                      </span>
                    )}
                  </td>
                  <td style={cellStyle}>{fmtInt(row.impressions)}</td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: color }} />
                      </div>
                      <span style={{
                        fontFamily: fMono, fontSize: 11, padding: '1px 7px', borderRadius: 4,
                        border: `0.5px solid ${color}`, color,
                      }}
                      >
                        {row.value != null ? `${row.value} %` : '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ ...cellStyle, textAlign: 'left', fontFamily: fInter, color: 'var(--text-tertiary)' }}>
                  Aucune zone en dérive.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
