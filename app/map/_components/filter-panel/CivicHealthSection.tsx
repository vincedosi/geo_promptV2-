'use client';

/**
 * Section « Santé environnementale » de la catégorie Audience : fiche
 * commune (ATMO + pollen de l'IRIS sélectionné) puis couche nationale
 * allergènes ou qualité de l'air, avec échelle, métrique, seuil et légende.
 *
 * Le bouton d'ingestion admin n'apparaît qu'à l'échelle code postal quand la
 * table du jour est vide (`civicCpStatus === 'no_data'`).
 *
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { HealthIndicatorCard } from '@/components/donnees-terrain/HealthIndicatorCard';
import { ATMO_LEVEL_LABELS, POLLEN_LEVEL_LABELS } from '@/lib/civic-health/levels';
import { FilterSectionHeader } from './FilterSectionHeader';
import { C, fInter, fMono } from './tokens';
import { labelStyle } from './styles';

/** Couches nationales disponibles : [valeur, libellé]. */
const HEALTH_LAYERS = [['pollen', '🌾 Allergènes'], ['atmo', '🌬️ Qualité de l’air']] as const;

/** Échelles de zones : [valeur, libellé]. */
const HEALTH_SCALES = [['departement', 'Département'], ['cp', 'Code postal']] as const;

/**
 * Au-delà de ce nombre de jours, la donnée est signalée comme périmée.
 *
 * Les tables `pollen_map_daily` et `atmo_map_daily` sont purgées à J-2 : elles
 * ne contiennent normalement que le jour et la veille. Trois jours laissent la
 * marge d'un décalage de fuseau ou d'un cron en retard ; au-delà, c'est que
 * l'ingestion ne tourne plus.
 */
const AGE_MAX_JOURS = 3;

/**
 * Âge de la donnée en jours, ou `null` si la date est absente ou illisible.
 *
 * Exportée pour être testée : c'est une fonction pure, et le cas qui compte —
 * une date absente ne doit PAS être lue comme « périmée depuis toujours » —
 * ne se vérifie pas en regardant le rendu.
 */
export function ageEnJours(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null;
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export interface CivicHealthSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;

  selectedIrisCommuneCode?: string | null;
  selectedIrisCommuneName?: string | null;

  civicHealthLayer?: 'pollen' | 'atmo' | null;
  onCivicHealthLayerChange?: (layer: 'pollen' | 'atmo' | null) => void;
  civicScale?: 'departement' | 'cp';
  onCivicScaleChange?: (s: 'departement' | 'cp') => void;
  civicMetric?: string;
  onCivicMetricChange?: (m: string) => void;
  civicMinLevel?: number;
  onCivicMinLevelChange?: (n: number) => void;

  civicProgress?: { done: number; total: number } | null;
  civicLoading?: boolean;
  civicCpStatus?: 'ok' | 'no_data' | null;
  civicCpDate?: string | null;

  /** Lance l'ingestion nationale (admin) et pousse son avancement. */
  runCivicIngestStream: () => void;
  civicIngestState: { running: boolean; message: string | null; error: string | null };
}

export function CivicHealthSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  selectedIrisCommuneCode,
  selectedIrisCommuneName,
  civicHealthLayer,
  onCivicHealthLayerChange,
  civicScale,
  onCivicScaleChange,
  civicMetric,
  onCivicMetricChange,
  civicMinLevel = 0,
  onCivicMinLevelChange,
  civicProgress,
  civicLoading,
  civicCpStatus,
  civicCpDate,
  runCivicIngestStream,
  civicIngestState,
}: CivicHealthSectionProps) {
  const ageDonneesJours = ageEnJours(civicCpDate);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FilterSectionHeader
        label="Santé environnementale"
        sectionKey="civicHealth"
        open={sectionsOpen.civicHealth === true}
        onToggle={() => toggleSection('civicHealth')}
        count={(selectedIrisCommuneCode ? 1 : 0) + (civicHealthLayer ? 1 : 0)}
        searchTerm={filterSearch}
      />
      {sectionsOpen.civicHealth === true && (
        <div style={{ animation: 'fadeIn 200ms var(--ease-out)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HealthIndicatorCard
            codeCommune={selectedIrisCommuneCode ?? null}
            nomCommune={selectedIrisCommuneName ?? null}
          />

          {/* Choix de la couche — une seule active à la fois, re-clic pour masquer */}
          <div>
            <div style={{ ...labelStyle, marginBottom: 4 }}>Couche nationale</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {HEALTH_LAYERS.map(([value, label]) => {
                const active = civicHealthLayer === value;
                return (
                  <button
                    key={value}
                    onClick={() => onCivicHealthLayerChange?.(active ? null : value)}
                    title={active ? 'Masquer la couche' : 'Afficher la couche'}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      fontFamily: fInter, cursor: 'pointer', transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover)',
                      background: active ? 'rgba(78,205,196,0.1)' : 'transparent',
                      border: `0.5px solid ${active ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                      color: active ? 'var(--brand-teal)' : C.textSec,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {civicHealthLayer && (
            <div style={{ animation: 'fadeIn 200ms var(--ease-out)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Échelle des zones */}
              <div>
                <div style={{ ...labelStyle, marginBottom: 4 }}>Échelle</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {HEALTH_SCALES.map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => onCivicScaleChange?.(value)}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                        fontFamily: fInter, cursor: 'pointer', transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover)',
                        background: civicScale === value ? 'rgba(78,205,196,0.1)' : 'transparent',
                        border: `0.5px solid ${civicScale === value ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                        color: civicScale === value ? 'var(--brand-teal)' : C.textSec,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Donnée CP absente : ingestion jamais lancée */}
              {civicScale === 'cp' && civicCpStatus === 'no_data' && (
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.2)',
                }}>
                  <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)', marginBottom: 6 }}>
                    Aucune donnée nationale — l&apos;ingestion quotidienne n&apos;a pas encore tourné.
                  </div>
                  <button
                    onClick={runCivicIngestStream}
                    disabled={civicIngestState.running}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                      fontFamily: fInter, cursor: civicIngestState.running ? 'wait' : 'pointer',
                      background: 'transparent', border: '0.5px solid var(--brand-teal)',
                      color: 'var(--brand-teal)', opacity: civicIngestState.running ? 0.6 : 1,
                    }}
                  >
                    {civicIngestState.running ? 'Ingestion en cours…' : 'Lancer l’ingestion (admin)'}
                  </button>
                </div>
              )}
              {/* Donnée périmée — l'ingestion tournait, puis s'est arrêtée.
                  Distinct du cas « aucune donnée » ci-dessus : ici la carte
                  AFFICHE quelque chose, et c'est précisément le danger. Mesuré le
                  2026-09-11 : les deux tables étaient figées au 3 juillet, soit
                  70 jours, sans que rien ne le signale. Sur un indicateur
                  saisonnier — l'ambroisie culmine en août, les graminées en juin —
                  une valeur de dix semaines est fausse ET plausible. */}
              {civicScale === 'cp' && ageDonneesJours !== null && ageDonneesJours > AGE_MAX_JOURS && (
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.2)',
                }}>
                  <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)', marginBottom: 6 }}>
                    Données vieilles de {ageDonneesJours} jours (du {civicCpDate}) — l&apos;ingestion
                    quotidienne ne tourne plus. Les niveaux affichés ne sont pas ceux d&apos;aujourd&apos;hui.
                  </div>
                  <button
                    onClick={runCivicIngestStream}
                    disabled={civicIngestState.running}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                      fontFamily: fInter, cursor: civicIngestState.running ? 'wait' : 'pointer',
                      background: 'transparent', border: '0.5px solid var(--brand-teal)',
                      color: 'var(--brand-teal)', opacity: civicIngestState.running ? 0.6 : 1,
                    }}
                  >
                    {civicIngestState.running ? 'Ingestion en cours…' : 'Rafraîchir maintenant (admin)'}
                  </button>
                </div>
              )}
              {(civicIngestState.message || civicIngestState.error) && (
                <div style={{ fontFamily: fMono, fontSize: 10, color: civicIngestState.error ? 'var(--danger)' : C.textDim }}>
                  {civicIngestState.error ?? civicIngestState.message}
                </div>
              )}

              {/* Métrique filtrée — espèce (pollen) ou polluant (air) */}
              <div>
                <div style={{ ...labelStyle, marginBottom: 4 }}>
                  {civicHealthLayer === 'pollen' ? 'Allergène' : 'Polluant'}
                </div>
                <select
                  value={civicMetric}
                  onChange={e => onCivicMetricChange?.(e.target.value)}
                  style={{
                    width: '100%', padding: '7px 11px', background: C.bgInput,
                    border: '0.5px solid var(--border-subtle)', borderRadius: 6,
                    fontFamily: fInter, fontSize: 12, color: C.text, cursor: 'pointer', outline: 'none',
                  }}
                >
                  <option value="global">Indice global</option>
                  {civicHealthLayer === 'pollen' ? (
                    <>
                      <option value="ambroisie">Ambroisie</option>
                      <option value="armoise">Armoise</option>
                      <option value="aulne">Aulne</option>
                      <option value="bouleau">Bouleau</option>
                      <option value="graminees">Graminées</option>
                      <option value="olivier">Olivier</option>
                    </>
                  ) : (
                    <>
                      <option value="no2">Dioxyde d&apos;azote (NO₂)</option>
                      <option value="o3">Ozone (O₃)</option>
                      <option value="pm10">Particules PM10</option>
                      <option value="pm25">Particules fines PM2.5</option>
                      <option value="so2">Dioxyde de soufre (SO₂)</option>
                    </>
                  )}
                </select>
              </div>

              {/* Seuil minimum — cœur du filtre zones à risque */}
              <div>
                <div style={{ ...labelStyle, marginBottom: 4 }}>Niveau minimum affiché</div>
                <select
                  value={civicMinLevel}
                  onChange={e => onCivicMinLevelChange?.(Number(e.target.value))}
                  style={{
                    width: '100%', padding: '7px 11px', background: C.bgInput,
                    border: `0.5px solid ${civicMinLevel > 0 ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
                    borderRadius: 6, fontFamily: fInter, fontSize: 12,
                    color: civicMinLevel > 0 ? 'var(--brand-teal)' : C.text,
                    cursor: 'pointer', outline: 'none',
                  }}
                >
                  <option value={0}>Tous les niveaux</option>
                  {civicHealthLayer === 'pollen' ? (
                    <>
                      <option value={3}>≥ modéré</option>
                      <option value={4}>≥ élevé</option>
                      <option value={5}>≥ très élevé</option>
                    </>
                  ) : (
                    <>
                      <option value={3}>≥ dégradé</option>
                      <option value={4}>≥ mauvais</option>
                      <option value={5}>≥ très mauvais</option>
                    </>
                  )}
                </select>
              </div>

              {/* Chargement : stream département (compteur) ou fetch CP */}
              {civicScale === 'departement' && civicProgress && civicProgress.done < civicProgress.total ? (
                <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                  Chargement… {civicProgress.done}/{civicProgress.total} départements
                </div>
              ) : civicLoading ? (
                <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                  Chargement de la couche…
                </div>
              ) : null}

              {/* Légende : un libellé par niveau (1-6) */}
              <div>
                <div style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, marginBottom: 6 }}>
                  {civicHealthLayer === 'pollen' ? 'Indice pollen' : 'Indice ATMO'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
                  {([1, 2, 3, 4, 5, 6] as const).map(lvl => {
                    const token = civicHealthLayer === 'pollen' ? `--pollen-level-${lvl}` : `--atmo-level-${lvl}`;
                    const label = civicHealthLayer === 'pollen' ? POLLEN_LEVEL_LABELS[lvl] : ATMO_LEVEL_LABELS[lvl];
                    const dimmed = civicMinLevel > 0 && lvl < civicMinLevel;
                    return (
                      <div key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: dimmed ? 0.3 : 1, transition: 'opacity 150ms var(--ease-hover)' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: `var(${token})`, flexShrink: 0 }} />
                        <span style={{ fontFamily: fInter, fontSize: 10, color: C.textSec }}>
                          {lvl} — {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
                Source : Atmo France et les AASQA (ODbL) — {civicScale === 'cp'
                  ? `max des communes par code postal${civicCpDate ? ` · données du ${civicCpDate}` : ''}`
                  : '1 commune par département'} · clic sur une zone pour le détail {civicHealthLayer === 'pollen' ? 'par espèce' : 'par polluant'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
