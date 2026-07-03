'use client';

/**
 * Sous-bloc "Pollen" de HealthIndicatorCard.
 * Pastille couleur globale + 6 espèces avec niveau 0-6.
 * Espèces inactives (niveau 0) grisées.
 */
import type { PollenIndicator, PollenSpecies } from '@/lib/civic-health/types';
import { POLLEN_LEVEL_LABELS, pollenLevelToken } from '@/lib/civic-health/levels';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const SPECIES_LABELS: Array<[PollenSpecies, string]> = [
  ['ambroisie', 'Ambroisie'],
  ['armoise', 'Armoise'],
  ['aulne', 'Aulne'],
  ['bouleau', 'Bouleau'],
  ['graminees', 'Graminées'],
  ['olivier', 'Olivier'],
];

interface Props {
  pollen: PollenIndicator;
}

export function PollenSubBlock({ pollen }: Props) {
  const globalLabel = POLLEN_LEVEL_LABELS[pollen.indice_global];

  return (
    <div data-testid="pollen-sub-block" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          fontFamily: fInter,
          fontSize: 10,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        Pollen
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-label={`Indice pollen ${pollen.indice_global} sur 6`}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: pollenLevelToken(pollen.indice_global),
            border: '1px solid var(--border-default)',
            flexShrink: 0,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {globalLabel}
          </span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
            {pollen.indice_global} / 6
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
        {SPECIES_LABELS.map(([key, label]) => {
          const lvl = pollen.especes[key];
          const inactive = lvl === 0;
          return (
            <div
              key={key}
              title={`${label} : ${POLLEN_LEVEL_LABELS[lvl]}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: inactive ? 0.45 : 1,
              }}
            >
              <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', width: 64 }}>
                {label}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 4,
                  background: 'var(--border-subtle)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(lvl / 6) * 100}%`,
                    height: '100%',
                    background: pollenLevelToken(lvl),
                  }}
                />
              </div>
              <span style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-secondary)', width: 14, textAlign: 'right' }}>
                {lvl}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
