import { InjectionToken, inject } from '@angular/core';
import { TiroirsExclusifs } from './tiroirs-exclusifs';

/**
 * Les tiroirs de ④ Analyse (retours du 26/10, T7) : les outils du premier niveau. « Analyse spatiale » est un en-tête
 * de GROUPE, pas un tiroir (A-11) ; à l'intérieur, la Bataille V2 a son propre repli (`batailleOuverte`) depuis le
 * retrait de la V1 (27/10) — Bataille V2 et Isochrones s'y excluaient (`outilOuvert`).
 */
export type TiroirAnalyse = 'couverture' | 'rayon' | 'score' | 'correlation' | 'clustering';

/**
 * Ouvert à l'ouverture de ④ : la couverture d'une zone, l'outil de tête (lot 4, T8), comme avant. Écart assumé à
 * A-11 du plan (« ④ aucun »), qui ignorait cet état initial : listé au rapport T7.
 */
export const TIROIR_ANALYSE_INITIAL: TiroirAnalyse = 'couverture';

/**
 * UN jeu de tiroirs pour ④, fourni par `PanneauAnalyseComponent` et partagé par ses outils (couverture, corrélation,
 * clustering) et ses services (`CouvertureRayonService.ouvert`, `ScoreCompositeService.ouvert` en DÉRIVENT) : une
 * seule source pour « qui est ouvert ».
 */
export const TIROIRS_ANALYSE = new InjectionToken<TiroirsExclusifs<TiroirAnalyse>>('TIROIRS_ANALYSE');

/** Le fournisseur du panneau. */
export const FOURNIR_TIROIRS_ANALYSE = {
  provide: TIROIRS_ANALYSE, useFactory: () => new TiroirsExclusifs<TiroirAnalyse>(TIROIR_ANALYSE_INITIAL),
};

/**
 * Les tiroirs de ④, à appeler dans un contexte d'injection. Sans fournisseur (outil ou service monté seul, en spec), un
 * jeu PROPRE à l'appelant, au même état initial : l'outil garde son comportement d'avant T7.
 */
export function injecterTiroirsAnalyse(): TiroirsExclusifs<TiroirAnalyse> {
  return inject(TIROIRS_ANALYSE, { optional: true }) ?? new TiroirsExclusifs<TiroirAnalyse>(TIROIR_ANALYSE_INITIAL);
}
