import { getCatColor } from '../_lib/constants';
import { Stat } from './Stat';
import type { ZoneData } from '@/types/spatial';

export function ZoneCard({ zone }: { zone: ZoneData }) {
  const catEntries = Object.entries(zone.categories ?? {}).sort((a, b) => b[1] - a[1]);
  const getColor = (cat: string) => zone.couleur_overrides?.[cat] ?? getCatColor(cat);

  return (
    <div style={{
      background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 10, padding: '12px 14px', marginTop: 8,
      fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16 }}>📍</span>
        <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 13 }}>{zone.ville}</span>
        {zone.rayon_metres && (
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            zone {(zone.rayon_metres / 1000).toFixed(1)} km
          </span>
        )}
        {zone.rayon_poi_metres && (
          <span style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, padding: '1px 6px', color: '#10b981', fontSize: 11 }}>
            ⊙ {zone.rayon_poi_metres >= 1000 ? `${(zone.rayon_poi_metres/1000).toFixed(1)} km` : `${zone.rayon_poi_metres} m`} / POI
          </span>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <Stat label="Établissements trouvés" value={String(zone.nb_pois)} color={zone.nb_pois > 0 ? '#3dffa0' : '#f59e0b'} />
      </div>

      {zone.nb_pois === 0 ? (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '7px 10px', color: '#f59e0b', fontSize: 11 }}>
          Aucun établissement dans ce rayon — essayez un rayon plus large
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {catEntries.map(([cat, count]) => (
            <span key={cat} style={{
              background: `${getColor(cat)}22`,
              border: `1px solid ${getColor(cat)}55`,
              borderRadius: 5, padding: '3px 7px',
              color: getColor(cat), fontSize: 11, fontWeight: 600,
            }}>
              {cat} · {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
