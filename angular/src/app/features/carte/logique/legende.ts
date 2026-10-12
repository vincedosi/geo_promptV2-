/**
 * Règles PURES de la légende unique de la carte (`legende/legende-carte.component.ts`) : quel dégradé a
 * un bloc, et les lignes de chaque bloc (paliers des carreaux et des IRIS, niveaux santé, compte PPRT).
 * Sorties du composant au lot 4 (T22) pour se tester sans TestBed. Les lignes qui lisent la couleur
 * d'une épingle POI restent dans le composant : elles dépendent de `couleurPoi` (couche POI).
 */
import { formaterNombre } from '../../../core/format/nombre';
import { type BornesEchelle, formaterValeur, palierEchelle, versValeurReelle } from './carreaux/bornes';
import { bornesInternes } from './carreaux/expressions';
import type { DegradeId } from './degrades';
import { type BornesIris, echelleDe } from './iris-echelle';
import { JETONS_NIVEAUX_SANTE } from './palettes-donnees-carte';
import { ATMO_LEVEL_LABELS, type JeuSante, POLLEN_LEVEL_LABELS } from './sante';

/**
 * Le dégradé actif a-t-il un bloc dans CETTE légende ? — `degradeALegende` de `LegendeCarte.tsx:150-178`, source
 * UNIQUE de la question : la boîte ne s'ouvre jamais vide. Le `switch` est EXHAUSTIF (`never`) : un dégradé ajouté à
 * `DegradeId` sans décision ici fait échouer la compilation.
 *
 * Côté React, `civic-indicateurs` et `civic-sante` vérifiaient aussi la variable / le jeu : ici, le dégradé n'est
 * réclamé QUE par `choisir(code)` / `choisirJeu(jeu)` non nuls, et l'éviction remet la variable à `null` — l'un ne va
 * pas sans l'autre. `score` et `diffusion` portent leur propre légende, comme React : celle du score est
 * `mg-legende-score` (T18), montée dans la légende mais posée en bas à droite. `zones-risque` a ici SON bloc (T13,
 * `mg-legende-zones-profil`) : React la renvoyait à `ZonesRisqueLayer`, qui n'en dessinait aucune — défaut corrigé.
 */
export function degradeALegende(d: DegradeId | null): boolean {
  if (!d) return false;
  switch (d) {
    case 'carreaux':
    case 'iris':
    case 'civic-indicateurs':
    case 'civic-sante':
    case 'meteo':
    case 'zones-risque':
      return true;
    case 'campagne-impressions':
      return false; // bloc à venir (lot 5)
    case 'score':
    case 'diffusion':
      return false;
    default: {
      const exhaustif: never = d;
      return exhaustif;
    }
  }
}

/** Un palier de la légende des carreaux : sa teinte, son libellé, s'il est sélectionné. */
export interface Palier {
  readonly index: number;
  readonly couleur: string;
  readonly libelle: string;
  readonly choisi: boolean;
}

/**
 * Les six paliers des carreaux (`LegendeCarte.tsx:198-214`), par le MÊME découpage (`palierEchelle`) que l'opacité
 * de la couche : une tranche cliquée désigne exactement les carreaux qu'elle affiche.
 */
export function paliersCarreaux(bornes: BornesEchelle, arrets: readonly string[], choisi: number | null): Palier[] {
  return arrets.map((couleur, i) => {
    const palier = palierEchelle(bornes, i, 6);
    const min = versValeurReelle(palier.min);
    const max = versValeurReelle(palier.max);
    return {
      index: i, couleur, choisi: choisi === i,
      libelle: i === 5 ? `≥ ${formaterValeur(min)}` : `${formaterValeur(min)} – ${formaterValeur(max)}`,
    };
  });
}

/** Les lignes « ≤ a », « a – b », « ≥ z » des IRIS (`LegendeCarte.tsx:236-248`), aux frontières de la peinture. */
export function paliersIris(bornes: BornesIris, arrets: readonly string[]): { couleur: string; libelle: string }[] {
  const n = arrets.length;
  const f = bornesInternes(echelleDe(bornes), n).map(versValeurReelle);
  return arrets.map((couleur, i) => ({
    couleur,
    libelle: i === 0 ? `≤ ${formaterValeur(f[0])}`
      : i === n - 1 ? `≥ ${formaterValeur(f[f.length - 1])}`
      : `${formaterValeur(f[i - 1])} – ${formaterValeur(f[i])}`,
  }));
}

/**
 * Les six niveaux du jeu santé affiché : `var(--pollen-level-N)` / `var(--atmo-level-N)` — c'est le DOM qui les lit,
 * le jeton y est résolu. Un niveau sous le seuil est estompé.
 */
export function niveauxDuJeuSante(jeu: JeuSante, seuil: number) {
  const libelles: Record<number, string> = jeu === 'pollen' ? POLLEN_LEVEL_LABELS : ATMO_LEVEL_LABELS;
  return {
    titre: jeu === 'pollen' ? 'Indice pollen' : 'Indice ATMO',
    niveaux: ([1, 2, 3, 4, 5, 6] as const).map((niveau) => ({
      niveau,
      couleur: `var(--${JETONS_NIVEAUX_SANTE[jeu][niveau]})`,
      libelle: `${niveau} — ${libelles[niveau]}`,
      estompe: seuil > 0 && niveau < seuil,
    })),
  };
}

/** Le rayon par POI de la zone d'analyse : « 1.5km » au-delà du kilomètre, « 800m » en deçà (`page.tsx:843`). */
export function libelleRayonPoi(metres: number | null | undefined): string | null {
  if (!metres) return null;
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)}km` : `${metres}m`;
}

/**
 * « N sites sur M ont un périmètre PPRT » (`BlocZonesRisque`, `LegendeCarte.tsx:534-590`) : la part de ce qu'on voit
 * qui repose sur une donnée de l'État. `null` sans compte ou sans site rendu.
 */
export function texteComptePprt(compte: { rendus: number; avecPprt: number } | null): string | null {
  if (!compte || compte.rendus <= 0) return null;
  const n = compte.avecPprt;
  return `${formaterNombre(n)} site${n > 1 ? 's' : ''} sur ${formaterNombre(compte.rendus)} ${n > 1 ? 'ont' : 'a'} un périmètre PPRT`;
}
