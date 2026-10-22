'use client';

/**
 * @file components/map/LegendeCarte.tsx — légende unique de la carte (Tâche 6,
 * 2026-09-12).
 *
 * Avant cette tâche, huit endroits rendaient chacun leur propre légende
 * (CarreauxSection, IrisSection, TmjaSection, CivicIndicatorsSection,
 * CivicHealthSection, SuiviMapLayer, MapPanel) : rien ne garantissait qu'une
 * seule s'affiche à la fois, ni qu'elles décrivent la même échelle que la
 * carte. Ce composant est désormais le SEUL à rendre une légende de dégradé —
 * les sections listées exportent leurs paliers (`TMJA_LEGEND`,
 * `ABSTENTION_LEGEND`, `legendePourMetrique`...) et ne les affichent plus
 * elles-mêmes.
 *
 * Position fixe en bas à gauche (spec §4) : `left: LARGEUR_RAIL +
 * ECART_RAIL_PANNEAU`, `bottom: 12`, `zIndex: 35` — sous les panneaux
 * (`OverlayPanel` = 40) et sous les widgets carte existants (ex.
 * `SuiviMapLayer`, `zIndex: 5000`, qui garde son propre mini-panneau de
 * bascule de métrique, hors périmètre de ce composant : voir le rapport de
 * tâche pour cette divergence assumée).
 *
 * Absorption du 2026-09-12 (Tâche 7) : la légende catégories POI / isochrone /
 * Voronoï / bataille d'`app/map/_components/MapPanel.tsx` (ex-lignes
 * ~267-393, boîte titrée « LEGENDE ») a été RAPATRIÉE ici (`BlocAnalyse`) et
 * retirée de `MapPanel.tsx` — avant cette tâche, deux légendes pouvaient
 * coexister à l'écran dans deux coins opposés. Les actions embarquées dans la
 * légende d'origine (bouton SAVE du Voronoï, slider du palier max de la
 * bataille) sont conservées : ce ne sont pas de simples clés de lecture, les
 * retirer aurait supprimé une fonctionnalité. Les badges de STATUT (zoom,
 * ZONE_ACTIVE, bascules Voronoï/Bataille, drawer Street View) restent dans
 * `MapPanel.tsx` : ce ne sont pas des légendes.
 * `app/map/analyse/digital/_components/MapLegend.tsx` reste en place (page
 * hors périmètre de la refonte, spec §4).
 */
import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { LARGEUR_RAIL, ECART_RAIL_PANNEAU } from '@/lib/navigation/config';
import type { DegradeId } from '@/lib/carte/degrades';
import { libelleDegrade } from '@/lib/carte/degrades';
import { CARREAUX_PALETTES, CARREAUX_INDICATEURS } from '@/lib/carreaux/catalogue';
import { uniteNormalisee } from '@/lib/carreaux/normalisation';
import { palierEchelle, versValeurReelle, formaterValeur, type BornesEchelle } from '@/lib/carreaux/bornes';
import { bornesInternes } from '@/lib/carreaux/expressions';
import { echelleDe, uniteIris, type BornesIris } from '@/lib/iris/echelle';
import { IRIS_PALETTES } from '@/app/map/_hooks/useMapLayers';
import { ABSTENTION_LEGEND, ABSTENTION_LEGEND_REPERES } from '@/app/map/_components/filter-panel/CivicIndicatorsSection';
import { ATMO_LEVEL_LABELS, POLLEN_LEVEL_LABELS } from '@/lib/civic-health/levels';
import { TMJA_LEGEND } from '@/app/map/_components/filter-panel/TmjaSection';
import { legendePourMetrique, type SuiviMapEventDetail } from '@/app/map/_components/SuiviMapLayer';
import { getCatColor, ISOCHRONE_COLORS, ISOCHRONE_MODE_LABELS, BATTLE_PALIER_OPACITY } from '@/app/map/_lib/constants';
import { LARGEUR_TRAIT_PPRT } from '@/lib/carte/palette-pprt';
import { formaterNombre } from '@/lib/format/nombre';
import type { ZoneData, VoronoiData } from '@/types/spatial';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export interface LegendeCarteProps {
  /** Dégradé de couleur actuellement actif (lib/carte/degrades.ts), ou null. */
  degradeActif: DegradeId | null;

  // Carreaux Filosofi
  carreauxIndicateur?: string;
  carreauxPalette?: string;
  carreauxRange?: BornesEchelle | null;
  carreauxSelectedBucket?: number | null;
  setCarreauxSelectedBucket?: (v: number | null) => void;

  // IRIS
  irisPalette?: string;
  irisBornes?: BornesIris | null;

  // Indicateurs civiques
  civicVariableCode?: 'abstention_pres_2022' | null;

  // Santé environnementale
  civicHealthLayer?: 'pollen' | 'atmo' | null;
  civicMinLevel?: number;

  // Météo (pas de gradient existant avant cette tâche — simple rappel du libellé actif)
  meteoLabel?: string | null;

  // Campagne active (SuiviMapLayer)
  campagneActive?: SuiviMapEventDetail | null;

  // Figurés ponctuels actifs
  selectedPOI?: string[];
  tmjaVisible?: boolean;
  tmjaHideLowTraffic?: boolean;
  radioVisible?: boolean;
  radioCoverageColor?: string;
  oohActif?: boolean;

  // ── Analyse spatiale (geo.prompt) — absorbé de MapPanel.tsx (Tâche 7) ─────
  /** Résultat de recherche geo.prompt courant — porte les catégories POI. */
  zoneData?: ZoneData | null;
  /** Catégories de `zoneData`, triées — vide/absent si aucun résultat. */
  activeCats?: string[];
  isochroneVisible?: boolean;
  isochroneMinutes?: number;
  isochroneMode?: string;
  voronoiVisible?: boolean;
  voronoiCategory?: string;
  voronoiPois?: { id: string; nom: string; color: string }[];
  voronoiDataRef?: React.MutableRefObject<VoronoiData | null>;
  battleVisible?: boolean;
  battleCategory?: string;
  battlePois?: { id: string; nom: string; color: string }[];
  battleMaxPalier?: number;
  setBattleMaxPalier?: (v: number) => void;

  // ── Risque industriel : zone CALCULÉE vs zone RÉGLEMENTAIRE ─────────────
  /** La couche des sites ICPE est-elle active ? */
  risquesActif?: boolean;
  /** Rayon de la zone calculée, en mètres. 0 = aucune zone calculée dessinée. */
  risquesRayonM?: number;
  /** La couche des périmètres PPRT est-elle active ? */
  pprtActif?: boolean;
  /** Sites rendus, et combien d'entre eux ont un vrai périmètre PPRT. */
  risquesCompte?: { rendus: number; total: number; avecPprt: number } | null;
}

const swatchRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const dotStyle: React.CSSProperties = { width: 10, height: 10, borderRadius: 2, flexShrink: 0 };
const titreStyle: React.CSSProperties = {
  fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4,
};
const labelStyle: React.CSSProperties = { fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' };

/**
 * `BlocDegrade` rendra-t-il quelque chose ?
 *
 * SOURCE UNIQUE de la question (constat 17 de la relecture d'interface) :
 * `LegendeCarte` décidait de s'afficher sur `degradeActif != null`, alors que
 * `BlocDegrade` rend `null` pour plusieurs dégradés — les deux ajoutés par
 * cette branche (`'score'` et `'diffusion'`, qui portent leur PROPRE légende
 * à côté de la carte) mais aussi `civic-indicateurs` sur une autre variable,
 * `civic-sante` sans couche et `campagne-impressions` sans campagne. Activer
 * le score composite ou la diffusion sans aucun figuré ni analyse faisait
 * donc apparaître une boîte « Légende » entièrement VIDE en bas à gauche,
 * posée par-dessus la légende propre de `ScoreMapLayer`.
 *
 * Le `switch` est EXHAUSTIF (`_exhaustif: never`) : un dégradé ajouté à
 * `DegradeId` sans décision ici fait échouer `tsc` au lieu de reproduire
 * silencieusement la boîte vide.
 */
function degradeALegende(props: LegendeCarteProps): boolean {
  const d = props.degradeActif;
  if (!d) return false;
  switch (d) {
    case 'carreaux':
    case 'iris':
    case 'meteo':
      return true;
    case 'civic-indicateurs':
      return props.civicVariableCode === 'abstention_pres_2022';
    case 'civic-sante':
      return Boolean(props.civicHealthLayer);
    case 'campagne-impressions':
      return Boolean(props.campagneActive);
    case 'score':
    case 'diffusion':
      // Légendes portées par `ScoreMapLayer` / `DiffusionMapLayer`.
      return false;
    case 'zones-risque':
      // Légende portée par `ZonesRisqueLayer`, qui seul connaît les classes du
      // profil courant — elles changent à chaque anneau ajouté ou retiré, et
      // une légende générique ne pourrait pas les nommer.
      return false;
    case 'couverture':
      // Réclamé par la seule carte Angular (④ Couverture d'une zone), dont la
      // légende vit dans le panneau de l'outil : jamais actif côté React.
      return false;
    default: {
      const _exhaustif: never = d;
      return _exhaustif;
    }
  }
}

/** Bloc légende du dégradé actif — une seule branche à la fois (exclusivité). */
function BlocDegrade(props: LegendeCarteProps) {
  const { degradeActif } = props;
  if (!degradeActif || !degradeALegende(props)) return null;

  if (degradeActif === 'carreaux') {
    const indicateur = props.carreauxIndicateur ?? 'population_totale';
    const uniteBrute = CARREAUX_INDICATEURS.find(i => i.id === indicateur)?.unit ?? '';
    const unite = uniteNormalisee(indicateur, uniteBrute);
    const pal = CARREAUX_PALETTES.find(p => p.id === (props.carreauxPalette ?? 'rouge')) ?? CARREAUX_PALETTES[0];
    const { carreauxRange, carreauxSelectedBucket, setCarreauxSelectedBucket } = props;
    return (
      <div>
        <div style={titreStyle}>
          {libelleDegrade('carreaux')}{unite && <span style={{ fontFamily: fMono, fontWeight: 400 }}> · {unite}</span>}
        </div>
        {carreauxRange ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {pal.stops.map((color, i) => {
              const palier = palierEchelle(carreauxRange, i, 6);
              const min = versValeurReelle(palier.min);
              const max = versValeurReelle(palier.max);
              const isSelected = carreauxSelectedBucket === i;
              return (
                <button key={i} type="button"
                  onClick={() => setCarreauxSelectedBucket?.(isSelected ? null : i)}
                  style={{ ...swatchRow, width: '100%', textAlign: 'left', background: isSelected ? `${color}22` : 'none', border: `0.5px solid ${isSelected ? color : 'transparent'}`, borderRadius: 2, padding: '1px 3px', cursor: 'pointer' }}
                >
                  <span style={{ ...dotStyle, background: color }} />
                  <span style={{ ...labelStyle, color: isSelected ? 'var(--text-primary)' : 'var(--text-tertiary)', flex: 1 }}>
                    {i === 5 ? `≥ ${formaterValeur(min)}` : `${formaterValeur(min)} – ${formaterValeur(max)}`}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {pal.stops.map((c, i) => <span key={i} style={{ display: 'inline-block', flex: 1, height: 7, background: c, borderRadius: 1 }} />)}
          </div>
        )}
      </div>
    );
  }

  if (degradeActif === 'iris') {
    const pal = IRIS_PALETTES.find(p => p.id === (props.irisPalette ?? 'bleu')) ?? IRIS_PALETTES[0];
    const { irisBornes } = props;
    return (
      <div>
        <div style={titreStyle}>
          {libelleDegrade('iris')}
          {irisBornes && <span style={{ fontFamily: fMono, fontWeight: 400 }}> · {uniteIris(irisBornes.classe) || '%'}</span>}
        </div>
        {irisBornes ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {(() => {
              const frontieres = bornesInternes(echelleDe(irisBornes), pal.stops.length).map(versValeurReelle);
              return pal.stops.map((color, i) => (
                <div key={i} style={swatchRow}>
                  <span style={{ ...dotStyle, background: color }} />
                  <span style={labelStyle}>
                    {i === 0 ? `≤ ${formaterValeur(frontieres[0])}`
                      : i === pal.stops.length - 1 ? `≥ ${formaterValeur(frontieres[frontieres.length - 1])}`
                      : `${formaterValeur(frontieres[i - 1])} – ${formaterValeur(frontieres[i])}`}
                  </span>
                </div>
              ));
            })()}
          </div>
        ) : irisBornes === undefined ? (
          <div style={{ ...labelStyle, fontFamily: fInter }}>Chargement...</div>
        ) : (
          <div style={{ ...labelStyle, fontFamily: fInter, color: 'var(--warning)' }}>! Aucune donnée pour cet indicateur</div>
        )}
      </div>
    );
  }

  if (degradeActif === 'civic-indicateurs' && props.civicVariableCode === 'abstention_pres_2022') {
    return (
      <div>
        <div style={titreStyle}>{libelleDegrade('civic-indicateurs')}</div>
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden' }}>
          {ABSTENTION_LEGEND.map(([color, weight], i) => (
            <div key={i} style={{ flex: weight, background: color }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          {ABSTENTION_LEGEND_REPERES.map(r => <span key={r} style={labelStyle}>{r}</span>)}
        </div>
      </div>
    );
  }

  if (degradeActif === 'civic-sante' && props.civicHealthLayer) {
    const labels = props.civicHealthLayer === 'pollen' ? POLLEN_LEVEL_LABELS : ATMO_LEVEL_LABELS;
    const civicMinLevel = props.civicMinLevel ?? 0;
    return (
      <div>
        <div style={titreStyle}>{props.civicHealthLayer === 'pollen' ? 'Indice pollen' : 'Indice ATMO'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
          {([1, 2, 3, 4, 5, 6] as const).map(lvl => {
            const token = props.civicHealthLayer === 'pollen' ? `--pollen-level-${lvl}` : `--atmo-level-${lvl}`;
            const dimmed = civicMinLevel > 0 && lvl < civicMinLevel;
            return (
              <div key={lvl} style={{ ...swatchRow, opacity: dimmed ? 0.3 : 1 }}>
                <span style={{ ...dotStyle, background: `var(${token})` }} />
                <span style={labelStyle}>{lvl} — {labels[lvl]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (degradeActif === 'meteo') {
    return (
      <div>
        <div style={titreStyle}>{libelleDegrade('meteo')}</div>
        <div style={labelStyle}>{props.meteoLabel ?? 'Couche active'}</div>
      </div>
    );
  }

  if (degradeActif === 'campagne-impressions' && props.campagneActive) {
    const stops = legendePourMetrique(props.campagneActive.metric, props.campagneActive.forecastCpm);
    return (
      <div>
        <div style={titreStyle}>{libelleDegrade('campagne-impressions')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {stops.map(([color, label]) => (
            <div key={label} style={swatchRow}>
              <span style={{ ...dotStyle, background: color }} />
              <span style={labelStyle}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

/**
 * Bloc légende d'analyse — résultat geo.prompt (catégories POI, isochrone,
 * Voronoï, bataille). Absorbé depuis `MapPanel.tsx` (Tâche 7, 2026-09-12) —
 * voir la note en tête de fichier. Conserve les actions embarquées dans la
 * légende d'origine (bouton SAVE du Voronoï, slider du palier max de la
 * bataille) : ce ne sont pas de simples clés de lecture.
 */
function BlocAnalyse(props: LegendeCarteProps) {
  const { zoneData } = props;
  const activeCats = props.activeCats ?? [];
  if (!zoneData || activeCats.length === 0) return null;

  const isoColors = ISOCHRONE_COLORS[props.isochroneMode ?? ''] ?? ISOCHRONE_COLORS.walk;
  const voronoiPois = props.voronoiPois ?? [];
  const battlePois = props.battlePois ?? [];
  const battleMaxPalier = props.battleMaxPalier ?? 90;

  return (
    <div>
      <div style={titreStyle}>Analyse spatiale</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {activeCats.map(cat => (
          <div key={cat} style={swatchRow}>
            <span style={{ ...dotStyle, borderRadius: '50%', background: zoneData.couleur_overrides?.[cat] ?? getCatColor(cat) }} />
            <span style={labelStyle}>{cat} <span style={{ color: 'var(--text-tertiary)' }}>({zoneData.categories[cat]})</span></span>
          </div>
        ))}

        {!!zoneData.rayon_metres && (
          <div style={{ marginTop: 3, paddingTop: 5, borderTop: '1px solid var(--border-subtle)', ...swatchRow }}>
            <span style={{ width: 9, height: 9, background: 'rgba(240,240,240,0.05)', borderRadius: 1, border: '1.5px dashed var(--border-hover)', flexShrink: 0 }} />
            <span style={labelStyle}>Zone {(zoneData.rayon_metres / 1000).toFixed(1)} km</span>
          </div>
        )}

        {!!zoneData.rayon_poi_metres && (
          <div style={{ marginTop: 3, paddingTop: 5, borderTop: '1px solid var(--border-subtle)', ...swatchRow }}>
            <span style={{ width: 9, height: 9, background: 'rgba(34,197,94,0.12)', borderRadius: '50%', border: '1.5px solid var(--success)', flexShrink: 0 }} />
            <span style={labelStyle}>
              R={zoneData.rayon_poi_metres >= 1000 ? `${(zoneData.rayon_poi_metres / 1000).toFixed(1)}km` : `${zoneData.rayon_poi_metres}m`}/POI
            </span>
          </div>
        )}

        {!!props.isochroneVisible && !!props.isochroneMinutes && (
          <div style={{ marginTop: 3, paddingTop: 5, borderTop: '1px solid var(--border-subtle)', ...swatchRow }}>
            <span style={{ width: 9, height: 9, background: `${isoColors.fill}30`, borderRadius: 1, border: `1.5px solid ${isoColors.line}`, flexShrink: 0 }} />
            <span style={labelStyle}>Iso {props.isochroneMinutes}min ({ISOCHRONE_MODE_LABELS[props.isochroneMode ?? ''] ?? props.isochroneMode})</span>
          </div>
        )}

        {!!props.voronoiVisible && !!props.voronoiCategory && (() => {
          const regionLabel = props.voronoiDataRef?.current?._meta?.filtre_region
            ?? props.voronoiDataRef?.current?._meta?.filtre_ville
            ?? props.voronoiDataRef?.current?._meta?.filtre_dept
            ?? null;
          return (
            <div style={{ marginTop: 3, paddingTop: 5, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 9, height: 9, background: (voronoiPois[0]?.color ?? 'var(--warning)') + '40', borderRadius: 1, border: `1.5px solid ${voronoiPois[0]?.color ?? 'var(--warning)'}`, flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-primary)', fontSize: 9, fontFamily: fInter, letterSpacing: '0.08em' }}>
                    VORONOI{regionLabel ? ` · ${regionLabel}` : ''}
                  </span>
                </div>
              </div>
              {voronoiPois.map(c => (
                <div key={c.id} style={swatchRow}>
                  <span style={{ width: 8, height: 8, background: c.color + '40', borderRadius: 1, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                  <span style={labelStyle}>{c.nom}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {!!props.battleVisible && !!props.battleCategory && (
          <div style={{ marginTop: 3, paddingTop: 5, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={swatchRow}>
              <span style={{ width: 9, height: 9, background: 'rgba(255,87,87,0.1)', borderRadius: 1, border: '1.5px solid var(--danger)', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-primary)', fontSize: 9, fontFamily: fInter, letterSpacing: '0.08em' }}>BATAILLE · {props.battleCategory}</span>
            </div>

            {/* Slider palier max */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 8, color: 'var(--text-tertiary)', fontFamily: fInter, letterSpacing: '0.08em' }}>PALIER_MAX</span>
                <span style={{ fontSize: 9, color: 'var(--danger)', fontFamily: fMono, fontWeight: 600 }}>{battleMaxPalier} min</span>
              </div>
              <input
                type="range"
                min={10} max={90} step={10}
                value={battleMaxPalier}
                onChange={e => props.setBattleMaxPalier?.(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--danger)', height: 14 }}
              />
              {/* Rampe opacité */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginTop: 1 }}>
                {[10, 20, 30, 40, 50, 60, 90].map(p => {
                  const active = p <= battleMaxPalier;
                  return (
                    <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flex: 1 }}>
                      <span style={{
                        display: 'inline-block', width: '100%', height: 6,
                        background: active ? `rgba(255,87,87,${BATTLE_PALIER_OPACITY[p] ?? 0.15})` : 'var(--bg-level-2)',
                        borderRadius: 1,
                        border: active ? 'none' : '1px solid var(--border-subtle)',
                        transition: 'background 0.2s',
                      }} />
                      <span style={{ fontSize: 7, color: 'var(--text-tertiary)' }}>{p}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Légende POIs */}
            {battlePois.slice(0, 8).map(c => (
              <div key={c.id} style={swatchRow}>
                <span style={{ width: 8, height: 8, background: c.color + '40', borderRadius: 1, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                <span style={labelStyle}>{c.nom}</span>
              </div>
            ))}
            {battlePois.length > 8 && (
              <span style={labelStyle}>+{battlePois.length - 8} autres</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Bloc figurés ponctuels — POI, TMJA, radio, OOH actuellement actifs. */
function BlocFigures(props: LegendeCarteProps) {
  const poi = props.selectedPOI ?? [];
  const items: { key: string; node: React.ReactNode }[] = [];

  for (const cat of poi) {
    items.push({
      key: `poi-${cat}`,
      node: (
        <div style={swatchRow}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: getCatColor(cat), flexShrink: 0 }} />
          <span style={labelStyle}>{cat}</span>
        </div>
      ),
    });
  }

  if (props.tmjaVisible) {
    for (const { color, label, isLow } of TMJA_LEGEND) {
      const dimmed = isLow && !!props.tmjaHideLowTraffic;
      items.push({
        key: `tmja-${label}`,
        node: (
          <div style={{ ...swatchRow, opacity: dimmed ? 0.35 : 1 }}>
            <span style={{ width: 14, height: 3, background: color, borderRadius: 2, flexShrink: 0 }} />
            <span style={labelStyle}>{label}</span>
          </div>
        ),
      });
    }
  }

  if (props.radioVisible) {
    items.push({
      key: 'radio',
      node: (
        <div style={swatchRow}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: props.radioCoverageColor ?? 'var(--brand-teal)', flexShrink: 0 }} />
          <span style={labelStyle}>Émetteurs radio</span>
        </div>
      ),
    });
  }

  if (props.oohActif) {
    items.push({ key: 'ooh', node: <span style={labelStyle}>Panneaux OOH affichés</span> });
  }

  if (items.length === 0) return null;

  return (
    <div>
      <div style={titreStyle}>Figurés</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(it => <div key={it.key}>{it.node}</div>)}
      </div>
    </div>
  );
}

/**
 * Zones à risque : la seule chose que cette boîte doit faire comprendre, c'est
 * **laquelle des deux zones on a calculée et laquelle vient de l'État**.
 *
 * Le motif du trait est la réponse, et il est reproduit ici depuis
 * `lib/carte/nature-zone.ts` plutôt que retapé : si le tireté change sur la
 * carte, il change ici. Une légende qui montre un trait que la carte ne
 * dessine pas est pire qu'une absence de légende.
 */
function BlocZonesRisque(props: LegendeCarteProps) {
  const zoneCalculee = !!props.risquesActif && (props.risquesRayonM ?? 0) > 0;
  const zoneReglementaire = !!props.pprtActif;
  if (!zoneCalculee && !zoneReglementaire) return null;

  const c = props.risquesCompte;

  return (
    <div>
      <div style={titreStyle}>Zones à risque</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {zoneReglementaire && (
          <div style={swatchRow}>
            <span
              aria-hidden
              style={{
                width: 16, height: 0, flexShrink: 0,
                borderTop: `${LARGEUR_TRAIT_PPRT}px solid var(--pprt-contour)`,
              }}
            />
            <span style={{ ...labelStyle, fontFamily: fInter, color: 'var(--text-secondary)' }}>
              Périmètre PPRT — réglementaire
            </span>
          </div>
        )}
        {zoneCalculee && (
          <div style={swatchRow}>
            <span
              aria-hidden
              style={{
                width: 16, height: 0, flexShrink: 0,
                borderTop: '1px dashed var(--text-secondary)',
              }}
            />
            <span style={{ ...labelStyle, fontFamily: fInter, color: 'var(--text-secondary)' }}>
              Rayon {formaterNombre(props.risquesRayonM ?? 0)} m — calculé
            </span>
          </div>
        )}
        {/*
          Le compte n'est pas décoratif : il dit quelle PART de ce qu'on voit
          repose sur une donnée de l'État. « 211 sur 1 024 » se lit autrement
          qu'une carte muette où tout paraît également fondé.
        */}
        {zoneCalculee && c && c.rendus > 0 && (
          <div style={{ ...labelStyle, lineHeight: 1.4 }}>
            {formaterNombre(c.avecPprt)} site{c.avecPprt > 1 ? 's' : ''} sur{' '}
            {formaterNombre(c.rendus)} {c.avecPprt > 1 ? 'ont' : 'a'} un périmètre PPRT
          </div>
        )}
        <div style={{ ...labelStyle, lineHeight: 1.4, color: 'var(--text-tertiary)' }}>
          Trait plein = publié par l&rsquo;État · tireté = calculé par dentsu.explore
        </div>
      </div>
    </div>
  );
}

export function LegendeCarte(props: LegendeCarteProps) {
  const [ouvert, setOuvert] = useState(true);

  // Jamais `degradeActif != null` : un dégradé sans légende dans ce bloc
  // ouvrirait une boîte « Légende » vide (constat 17, voir `degradeALegende`).
  const degradeVisible = degradeALegende(props);
  const poiCount = props.selectedPOI?.length ?? 0;
  const figuresVisible = poiCount > 0 || !!props.tmjaVisible || !!props.radioVisible || !!props.oohActif;
  const analyseVisible = !!props.zoneData && (props.activeCats?.length ?? 0) > 0;
  // Même règle que les trois autres blocs : la boîte ne s'ouvre que si ce
  // bloc rendra quelque chose, sinon on reproduit la « Légende » vide du
  // constat 17.
  const zonesRisqueVisible =
    (!!props.risquesActif && (props.risquesRayonM ?? 0) > 0) || !!props.pprtActif;

  if (!degradeVisible && !figuresVisible && !analyseVisible && !zonesRisqueVisible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: LARGEUR_RAIL + ECART_RAIL_PANNEAU,
        bottom: 12,
        zIndex: 35,
        background: 'var(--card-overlay, rgba(10,10,10,0.92))',
        // Même jeton que les trois autres panneaux flottants de
        // `components/map/` : un `8px` en dur floutait deux fois plus fort
        // que la top bar et l'overlay, et ne suivrait pas un changement du
        // jeton (constat 22).
        backdropFilter: 'blur(var(--backdrop-blur, 4px))',
        WebkitBackdropFilter: 'blur(var(--backdrop-blur, 4px))',
        border: '0.5px solid var(--border-default)',
        borderRadius: 8,
        minWidth: 180,
        maxWidth: 240,
      }}
    >
      <button
        type="button"
        onClick={() => setOuvert(v => !v)}
        aria-expanded={ouvert}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          Légende
        </span>
        {ouvert
          ? <ChevronDown size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          : <ChevronRight size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
      </button>
      {ouvert && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <BlocAnalyse {...props} />
          <BlocDegrade {...props} />
          <BlocZonesRisque {...props} />
          <BlocFigures {...props} />
        </div>
      )}
    </div>
  );
}
