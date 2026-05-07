'use client';

/**
 * Sous-bloc "Air" de HealthIndicatorCard.
 * Affiche : pastille couleur ATMO + qualificatif + 5 sous-indices polluants.
 */
import type { AirIndicator } from '@/lib/civic-health/types';
import { atmoLevelToken } from '@/lib/civic-health/levels';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const POLLUTANT_LABELS: Array<['pm10' | 'pm25' | 'no2' | 'o3' | 'so2', string]> = [
  ['no2', 'NO₂'],
  ['o3', 'O₃'],
  ['pm10', 'PM10'],
  ['pm25', 'PM2,5'],
  ['so2', 'SO₂'],
];

interface Props {
  air: AirIndicator;
}

export function AirSubBlock({ air }: Props) {
  return (
    <div data-testid="air-sub-block" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          fontFamily: fInter,
          fontSize: 10,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        Air
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-label={`Indice ATMO ${air.indice} sur 6`}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: atmoLevelToken(air.indice),
            border: '1px solid var(--border-default)',
            flexShrink: 0,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {air.qualificatif}
          </span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
            {air.indice} / 6
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
        {POLLUTANT_LABELS.map(([key, label]) => {
          const lvl = air.sous_indices[key];
          return (
            <div
              key={key}
              title={
                lvl == null
                  ? `${label} : indisponible`
                  : `${label} : niveau ${lvl}/6`
              }
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)', width: 32 }}>
                {label}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 4,
                  background: 'var(--border-subtle)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {lvl != null && (
                  <div
                    style={{
                      width: `${(lvl / 6) * 100}%`,
                      height: '100%',
                      background: atmoLevelToken(lvl),
                    }}
                  />
                )}
              </div>
              <span style={{ fontFamily: fMono, fontSize: 9, color: lvl == null ? 'var(--text-tertiary)' : 'var(--text-secondary)', width: 14, textAlign: 'right' }}>
                {lvl ?? '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
