'use client';

/**
 * TrioCartes — les trois vignettes carte du Suivi V2 (Tâche 13A,
 * task-13-brief.md) : Impressions, Variable du plan, Alignement. Même
 * projection et même cadrage pour les trois (`fitBounds` partagé, calculé
 * ICI une seule fois sur l'enveloppe du périmètre actif — jamais recalculé
 * par vignette, pour garantir un cadrage identique par construction).
 *
 * Composant PROPS-DRIVÉ, pas de fetch : reçoit `features`, déjà calculées
 * par la route `.../alignement/maille/map` (RPC `alignement_par_maille_geo`,
 * sql/165) — Task 15 orchestre l'appel réseau et le passage à l'indicateur
 * sélectionné. Les trois vignettes lisent le MÊME tableau `features` : les
 * trois propriétés `impressions` / `variable_valeur` / `ecart_pct` sont déjà
 * portées par chaque feature (une seule requête pour les trois cartes).
 *
 * `CarteVignette` importe `maplibre-gl`, qui touche `window` à
 * l'initialisation : chargé en `next/dynamic({ ssr: false })`, jamais en
 * import statique (le SSR de `/map` planterait sur `window is undefined`).
 *
 * Le sélecteur d'indicateur (Tâche 13 Step 2) vit dans l'en-tête de la
 * vignette « Variable du plan », HORS du bouton d'ouverture de
 * `CarteVignette` (`controleEnTete`) — imbriquer un `<select>` dans un
 * `<button>` est invalide en HTML et casserait le clic d'ouverture.
 */
import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { retryImport } from '@/lib/dynamic-with-retry';
import {
  enveloppeFeatures,
  type FeatureAlignementGeo,
  type TypeVignette,
} from '@/lib/campagne/vignette-carte';

const fInter = "'Inter', system-ui, sans-serif";

const CarteVignette = dynamic(
  retryImport(() => import('./CarteVignette').then((m) => ({ default: m.CarteVignette }))),
  { ssr: false, loading: () => null },
);

/** Bbox métropolitaine — même repli que la route `.../alignement/maille/map`
 *  (et `suivi/map`) quand aucune feature n'a de géométrie exploitable. */
const BBOX_METRO: [number, number, number, number] = [-5.5, 41.2, 9.8, 51.2];

export interface IndicateurOption {
  indicator_code: string;
  label: string;
}

export interface VariableActive {
  code: string;
  label: string;
  unite?: string | null;
}

export interface TrioCartesProps {
  /** Features partagées par les trois vignettes — porte `impressions`,
   *  `variable_valeur` (pour l'indicateur COURANT, `variableActive.code`) et
   *  `ecart_pct`, plus la géométrie. */
  features: FeatureAlignementGeo[];
  theme: 'dark' | 'light';
  chargement?: boolean;
  erreur?: string | null;
  variableActive: VariableActive;
  indicateursDisponibles: IndicateurOption[];
  onChangeIndicateur?: (code: string) => void;
  /** Clic sur une vignette entière — 13B décide ce que ça ouvre. */
  onOuvrir?: (type: TypeVignette) => void;
}

export function TrioCartes({
  features, theme, chargement, erreur, variableActive, indicateursDisponibles,
  onChangeIndicateur, onOuvrir,
}: TrioCartesProps) {
  // Cadrage PARTAGÉ — calculé une fois ici, jamais par vignette (même
  // projection, même cadrage pour les trois, Tâche 13 Step 1).
  const bounds = useMemo<[number, number, number, number]>(
    () => enveloppeFeatures(features) ?? BBOX_METRO,
    [features],
  );

  if (erreur) {
    return (
      <div
        role="alert"
        style={{
          padding: 12, borderRadius: 8, border: '0.5px solid var(--danger)',
          background: 'rgba(255,87,87,0.1)', fontFamily: fInter, fontSize: 12, color: 'var(--danger)',
        }}
      >
        {erreur}
      </div>
    );
  }

  const selecteurIndicateur = (
    <select
      value={variableActive.code}
      onChange={(e) => onChangeIndicateur?.(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label="Choisir un autre indicateur pour la variable du plan"
      style={{
        background: 'var(--bg-level-2)', border: '0.5px solid var(--border-default)',
        borderRadius: 6, padding: '4px 6px', fontFamily: fInter, fontSize: 11,
        color: 'var(--text-secondary)', maxWidth: 108,
      }}
    >
      {indicateursDisponibles.map((ind) => (
        <option key={ind.indicator_code} value={ind.indicator_code}>{ind.label}</option>
      ))}
    </select>
  );

  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14,
      }}
    >
      <CarteVignette
        type="impressions"
        titre="Impressions"
        sousTitre="Où la campagne a réellement diffusé."
        features={features}
        bounds={bounds}
        theme={theme}
        chargement={chargement}
        onOuvrir={onOuvrir ? () => onOuvrir('impressions') : undefined}
      />
      <CarteVignette
        type="variable"
        titre={variableActive.label}
        sousTitre="La variable qui a servi à bâtir le plan."
        features={features}
        bounds={bounds}
        theme={theme}
        chargement={chargement}
        onOuvrir={onOuvrir ? () => onOuvrir('variable') : undefined}
        controleEnTete={indicateursDisponibles.length > 0 ? selecteurIndicateur : undefined}
      />
      <CarteVignette
        type="alignement"
        titre="Alignement géo"
        sousTitre="L'écart entre les deux, zone par zone."
        features={features}
        bounds={bounds}
        theme={theme}
        chargement={chargement}
        onOuvrir={onOuvrir ? () => onOuvrir('alignement') : undefined}
      />
    </div>
  );
}
