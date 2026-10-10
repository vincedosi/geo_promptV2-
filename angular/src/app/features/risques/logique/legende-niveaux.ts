import { LIBELLE_NIVEAU, NIVEAUX, type Niveau, type ProfilRayons, anneauxDuNiveau } from './profil';

/**
 * Ce que disent les légendes des zones de risque — partagé par la carte du module (`carte-risque.component.ts`) et par
 * la légende de la carte principale (`legende-zones-profil.component.ts`, lot 4, T13) : deux légendes qui décrivent
 * les mêmes tuiles doivent dire la même chose, donc venir d'une seule source.
 */

/**
 * Le jeton CSS de la teinte de chaque niveau (`--niveau-*`). Une seule table : le DOM l'écrit en `var(--…)`, MapLibre
 * la reçoit résolue par `CouleursService` (jamais `var()` dans `paint`).
 */
export const JETON_NIVEAU: Readonly<Record<Niveau, string>> = {
  haut: 'niveau-haut',
  bas: 'niveau-bas',
  autres: 'niveau-autres',
};

/** Les teintes des couches de zones : une par niveau, plus le halo des étiquettes (inversé entre thèmes). */
export const JETONS_TEINTES_ZONES = { ...JETON_NIVEAU, halo: 'halo-carte' } as const;

/** La convention de trait (`nature-zone.ts`), telle que les légendes l'écrivent. */
export const CONVENTION_TRAIT = 'Trait plein : périmètre publié par l’État. Tireté : rayon que nous calculons.';

/** Un niveau de légende : son libellé, son jeton, les rayons de ses anneaux (forme de `mg-legende-niveaux`). */
export interface NiveauDeLegende {
  libelle: string;
  jeton: string;
  anneaux: readonly number[];
}

/**
 * Les trois niveaux d'un profil, dans l'ordre de `NIVEAUX`, avec les anneaux RÉELLEMENT appliqués (`anneauxDuNiveau` :
 * un profil lié prête les anneaux du seuil haut). Un niveau sans anneau est rendu tel quel : c'est `mg-legende-niveaux`
 * qui le tait.
 */
export function niveauxLegende(profil: ProfilRayons): NiveauDeLegende[] {
  return NIVEAUX.map((n) => ({ libelle: LIBELLE_NIVEAU[n], jeton: JETON_NIVEAU[n], anneaux: anneauxDuNiveau(profil, n) }));
}
