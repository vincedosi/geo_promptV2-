'use client';

/**
 * HealthIndicatorCard — affiche les indicateurs ATMO (air) + pollen pour la
 * commune dont relève l'IRIS sélectionné. Plié par défaut côté parent.
 *
 * Source : Atmo France et AASQA (licence ODbL, mention obligatoire affichée
 * dans le footer du composant).
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type {
  HealthApiResponse,
  HealthIndicator,
} from '@/lib/civic-health/types';
import { atmoLevelToken, pollenLevelToken, POLLEN_LEVEL_LABELS } from '@/lib/civic-health/levels';
import { AirSubBlock } from './AirSubBlock';
import { PollenSubBlock } from './PollenSubBlock';
import { HealthCardSkeleton } from './HealthCardSkeleton';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  /** Code INSEE 5 caractères de la commune dont relève l'IRIS sélectionné. */
  codeCommune: string | null;
  /** Nom de la commune (optionnel, pour affichage au-dessus de la carte). */
  nomCommune?: string | null;
}

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: HealthIndicator }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function HealthIndicatorCard({ codeCommune, nomCommune }: Props) {
  const [state, setState] = useState<FetchState>({ kind: 'idle' });
  const [showForecast, setShowForecast] = useState(false);

  // Cache client : { code_commune → HealthIndicator } (mémoire session, économise les fetch).
  const cacheRef = useRef<Map<string, HealthIndicator>>(new Map());

  useEffect(() => {
    if (!codeCommune) {
      setState({ kind: 'idle' });
      return;
    }

    const cached = cacheRef.current.get(codeCommune);
    if (cached) {
      setState({ kind: 'success', data: cached });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    adminFetch(`/api/civic-indicators/health/${codeCommune}`, {
      headers: { Accept: 'application/json' },
    })
      .then(async res => {
        const json = (await res.json()) as HealthApiResponse;
        if (cancelled) return;
        if (!res.ok || !json.data) {
          setState({
            kind: 'empty',
            message:
              json.message ?? 'Données indisponibles pour cette zone.',
          });
          return;
        }
        cacheRef.current.set(codeCommune, json.data);
        setState({ kind: 'success', data: json.data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[HealthIndicatorCard] fetch error', err);
        setState({
          kind: 'error',
          message: 'Échec de chargement. Réessayer ?',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [codeCommune]);

  // ── État : aucune zone sélectionnée ────────────────────────────────────────
  if (!codeCommune || state.kind === 'idle') {
    return (
      <div
        data-testid="civic-health-empty"
        style={{
          padding: '14px',
          fontFamily: fInter,
          fontSize: 11,
          color: 'var(--text-tertiary)',
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}
      >
        Cliquez sur un IRIS pour voir l&apos;air et les pollens du jour.
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (state.kind === 'loading') {
    return <HealthCardSkeleton />;
  }

  // ── Erreur ────────────────────────────────────────────────────────────────
  if (state.kind === 'error') {
    return (
      <div
        data-testid="civic-health-error"
        style={{
          padding: '14px',
          fontFamily: fInter,
          fontSize: 11,
          color: 'var(--danger)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span>{state.message}</span>
        <button
          type="button"
          onClick={() => {
            cacheRef.current.delete(codeCommune);
            setState({ kind: 'loading' });
            // Re-déclenche l'effet en touchant la dépendance via re-render.
            const c = codeCommune;
            adminFetch(`/api/civic-indicators/health/${c}`)
              .then(async res => {
                const json = (await res.json()) as HealthApiResponse;
                if (!res.ok || !json.data) {
                  setState({ kind: 'empty', message: json.message ?? 'Données indisponibles.' });
                } else {
                  cacheRef.current.set(c, json.data);
                  setState({ kind: 'success', data: json.data });
                }
              })
              .catch(() => setState({ kind: 'error', message: 'Échec de chargement. Réessayer ?' }));
          }}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: '0.5px solid var(--brand-teal)',
            color: 'var(--brand-teal)',
            borderRadius: 6,
            padding: '6px 12px',
            fontFamily: fInter,
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  // ── Empty (commune sans data) ─────────────────────────────────────────────
  if (state.kind === 'empty') {
    return (
      <div
        data-testid="civic-health-unavailable"
        style={{
          padding: '14px',
          fontFamily: fInter,
          fontSize: 11,
          color: 'var(--text-tertiary)',
          lineHeight: 1.5,
        }}
      >
        {state.message}
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  const { data } = state;
  const hasForecast =
    !!data.air?.previsionJ1 ||
    !!data.pollen?.previsionJ1 ||
    !!data.pollen?.previsionJ2;

  return (
    <div
      data-testid="civic-health-card"
      style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Commune + badge stale éventuel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          {nomCommune || data.commune}
        </span>
        {data.stale && (
          <span
            title="Donnée de fallback (cache > 24h)"
            style={{
              fontFamily: fMono,
              fontSize: 9,
              color: 'var(--warning)',
              background: 'rgba(247,183,49,0.1)',
              border: '0.5px solid rgba(247,183,49,0.3)',
              borderRadius: 3,
              padding: '2px 6px',
            }}
          >
            cache
          </span>
        )}
      </div>

      {/* Grille Air | Pollen */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: data.air && data.pollen ? '1fr 1fr' : '1fr',
          gap: 14,
        }}
      >
        {data.air && <AirSubBlock air={data.air} />}
        {data.pollen && <PollenSubBlock pollen={data.pollen} />}
      </div>

      {/* Toggle prévisions */}
      {hasForecast && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
          <button
            type="button"
            onClick={() => setShowForecast(s => !s)}
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontFamily: fInter,
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {showForecast ? '▾ Masquer prévisions' : '▸ Voir prévisions'}
          </button>
          {showForecast && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontFamily: fMono,
                fontSize: 10,
                color: 'var(--text-secondary)',
                paddingLeft: 12,
                borderLeft: '1px solid var(--border-subtle)',
              }}
            >
              {data.air?.previsionJ1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 28, color: 'var(--text-tertiary)' }}>J+1</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Air
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: atmoLevelToken(data.air.previsionJ1.indice),
                        display: 'inline-block',
                      }}
                    />
                    <span style={{ textTransform: 'capitalize' }}>{data.air.previsionJ1.qualificatif}</span>
                  </span>
                  {data.pollen?.previsionJ1 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      · Pollen
                      <span
                        style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: pollenLevelToken(data.pollen.previsionJ1.indice),
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ textTransform: 'capitalize' }}>{POLLEN_LEVEL_LABELS[data.pollen.previsionJ1.indice]}</span>
                    </span>
                  )}
                </div>
              )}
              {data.pollen?.previsionJ2 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 28, color: 'var(--text-tertiary)' }}>J+2</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Pollen
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: pollenLevelToken(data.pollen.previsionJ2.indice),
                        display: 'inline-block',
                      }}
                    />
                    <span style={{ textTransform: 'capitalize' }}>{POLLEN_LEVEL_LABELS[data.pollen.previsionJ2.indice]}</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer source ODbL */}
      <div
        style={{
          marginTop: 4,
          paddingTop: 8,
          borderTop: '0.5px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontFamily: fMono,
          fontSize: 9,
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}
      >
        <span>
          Source : {data.source}
          {data.air?.date && ` — Mis à jour le ${formatDate(data.air.date)}`}
        </span>
        <a
          href={`https://map.atmo-france.org/?commune=${encodeURIComponent(data.code_insee)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--brand-teal)', textDecoration: 'none' }}
        >
          ↗ Voir sur map.atmo-france.org
        </a>
      </div>
    </div>
  );
}
