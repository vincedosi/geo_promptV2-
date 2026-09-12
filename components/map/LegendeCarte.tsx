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
 * Divergence assumée avec `app/copilote/_components/MapPanel.tsx` (légende
 * catégories POI / isochrone / voronoi / bataille, lignes ~267-300) :
 * NON absorbée ici. Cette légende décrit un résultat d'ANALYSE (geo.prompt,
 * bataille isochrone, Voronoï) hors des six groupes du panneau Calques que
 * cette tâche définit — l'absorber aurait mélangé deux axes de données
 * différents pour un composant central de 493 lignes, hors périmètre motivé
 * par un risque disproportionné. `app/map/analyse/digital/_components/MapLegend.tsx`
 * reste également en place (page hors périmètre de la refonte, spec §4).
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
import { IRIS_PALETTES } from '@/app/copilote/_hooks/useMapLayers';
import { ABSTENTION_LEGEND, ABSTENTION_LEGEND_REPERES } from '@/app/map/_components/filter-panel/CivicIndicatorsSection';
import { ATMO_LEVEL_LABELS, POLLEN_LEVEL_LABELS } from '@/lib/civic-health/levels';
import { TMJA_LEGEND } from '@/app/map/_components/filter-panel/TmjaSection';
import { legendePourMetrique, type SuiviMapEventDetail } from '@/app/map/_components/SuiviMapLayer';
import { getCatColor } from '@/app/copilote/_lib/constants';

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
}

const swatchRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const dotStyle: React.CSSProperties = { width: 10, height: 10, borderRadius: 2, flexShrink: 0 };
const titreStyle: React.CSSProperties = {
  fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4,
};
const labelStyle: React.CSSProperties = { fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' };

/** Bloc légende du dégradé actif — une seule branche à la fois (exclusivité). */
function BlocDegrade(props: LegendeCarteProps) {
  const { degradeActif } = props;
  if (!degradeActif) return null;

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

export function LegendeCarte(props: LegendeCarteProps) {
  const [ouvert, setOuvert] = useState(true);

  const degradeVisible = props.degradeActif != null;
  const poiCount = props.selectedPOI?.length ?? 0;
  const figuresVisible = poiCount > 0 || !!props.tmjaVisible || !!props.radioVisible || !!props.oohActif;

  if (!degradeVisible && !figuresVisible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: LARGEUR_RAIL + ECART_RAIL_PANNEAU,
        bottom: 12,
        zIndex: 35,
        background: 'var(--card-overlay, rgba(10,10,10,0.92))',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
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
          <BlocDegrade {...props} />
          <BlocFigures {...props} />
        </div>
      )}
    </div>
  );
}
