'use client';

import type { ZoneData, SynergyMeta } from '@/types/spatial';

interface SynergyResultsProps {
  zoneData: ZoneData;
}

export function SynergyResults({ zoneData }: SynergyResultsProps) {
  const s = zoneData._synergy as SynergyMeta;
  const top3 = zoneData.pois.slice(0, 3);

  return (
    <div style={{
      margin: '8px 0',
      background: 'linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(245,158,11,0.05) 100%)',
      border: '1px solid rgba(245,158,11,0.3)',
      borderRadius: 10,
      padding: '12px 14px',
      fontSize: 12,
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🎯</span>
        <div>
          <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>
            {zoneData.nb_pois} panneau{zoneData.nb_pois > 1 ? 'x' : ''} stratégique{zoneData.nb_pois > 1 ? 's' : ''}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 1 }}>
            à moins de {s.max_distance_m}m d'un <span style={{ color: '#4ecdc4', fontWeight: 600 }}>{s.poi_category}</span>
            {' '}· cible{' '}
            <span style={{ color: '#34d399', fontWeight: 600 }}>{s.target_demo_label}</span>
          </div>
        </div>
      </div>

      {/* Audience totale */}
      <div style={{
        background: 'rgba(245,158,11,0.12)',
        borderRadius: 6,
        padding: '6px 10px',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>Audience cumulée (Top {zoneData.nb_pois})</span>
        <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14 }}>
          {s.total_audience.toLocaleString('fr-FR')} pers.
        </span>
      </div>

      {/* Top 3 */}
      {top3.length > 0 && (
        <div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>
            TOP {Math.min(3, top3.length)} PANNEAUX
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {top3.map((p: any) => (
              <div key={p.id} style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr auto',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 6,
                padding: '6px 8px',
              }}>
                <span style={{
                  width: 20, height: 20,
                  background: p.rank === 1 ? '#f59e0b' : p.rank === 2 ? '#94a3b8' : '#92400e',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: '#000',
                  flexShrink: 0,
                }}>
                  {p.rank}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.nom}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>
                    {[p.adresse, p.sous_categorie, p.ville].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ color: '#34d399', fontWeight: 700, fontSize: 12 }}>
                    {Number(p.audience).toLocaleString('fr-FR')}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>pers.</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer params */}
      <div style={{
        marginTop: 8,
        paddingTop: 6,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        {[
          { label: 'Rayon POI', value: s.max_distance_m + 'm' },
          { label: 'Zone visib.', value: s.buffer_radius_m + 'm' },
          { label: 'Colonne', value: s.target_demo_col },
        ].map(({ label, value }) => (
          <span key={label} style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
            padding: '2px 6px',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 10,
          }}>
            {label}: <span style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
