import { type Signal, computed, inject } from '@angular/core';
import { CouleursService } from '../../../../../../core/theme/couleurs.service';
import type { CadreGraphique } from '../../../../logique/clustering/options-graphiques';
import type { DetailModele, MoyennesFrance, PoiModele, ResumeCluster } from '../../../../logique/clustering/types';

/** Ce que chaque onglet du rapport reçoit : le modèle, son résumé par cluster, ses POI, les moyennes nationales. */
export interface DonneesRapport {
  modele: DetailModele;
  resume: Record<string, ResumeCluster>;
  pois: PoiModele[];
  /** `null` : moyennes non calculées (404) — les onglets s'affichent sans référence, comme React. */
  france: MoyennesFrance | null;
  /** Les identifiants de cluster, croissants. */
  cids: string[];
}

/**
 * La teinte d'un cluster : celle que rend la route, déjà validée au chargement (`rapport-clusters`) ; à défaut le gris
 * de la donnée absente, en valeur CALCULÉE (elle part aussi vers ECharts, qui ne lit pas `var()`) — un seul repli pour
 * les sept onglets (revue 1 : quatre d'entre eux passaient une couleur vide).
 */
export function couleurCluster(d: DonneesRapport, cid: string, absente: string): string {
  return d.resume[cid]?.color ?? absente;
}

/**
 * Le cadre `Panel` de React (`ClusterDetails.tsx:139-155`) et ses textes — fond carte, bord fin, titre Inter 500 12 px
 * — partagé par les sept onglets (chaque composant ajoute cette feuille à ses `styles`).
 */
export const STYLES_RAPPORT = `
  .panneau-rapport { background: var(--bg-surface); border: 0.5px solid var(--border-subtle); border-radius: 2px; padding: 20px; min-width: 0; }
  .pleine-largeur { grid-column: 1 / -1; }
  .titre { font-family: var(--font-sans); font-weight: 500; font-size: 12px; color: var(--text-primary); margin-bottom: 14px; }
  .mono { font-family: var(--font-mono); }
  .ligne-fine { border-bottom: 0.5px solid color-mix(in srgb, var(--border-subtle) 50%, transparent); }
  .pastille { display: inline-block; flex-shrink: 0; border-radius: 1px; }
`;

/** Les jetons du cadre des graphiques (`C` de `ClusterDetails.tsx:15-28`, et les couleurs d'écart devenues jetons). */
const JETONS_CADRE = {
  texte: 'text-secondary', texteDiscret: 'text-tertiary', textePrincipal: 'text-primary', bord: 'border-subtle',
  fondInfobulle: 'bg-surface', positif: 'success', negatif: 'danger', reference: 'text-tertiary', absente: 'donnee-absente',
} as const;

/**
 * Le cadre des graphiques ECharts, couleurs CALCULÉES et suivies au thème (ECharts ne lit pas `var()`). À appeler dans
 * un contexte d'injection (champ de composant).
 */
export function cadreGraphique(): Signal<CadreGraphique & { absente: string }> {
  const palette = inject(CouleursService).palette(JETONS_CADRE);
  return computed(() => palette());
}
