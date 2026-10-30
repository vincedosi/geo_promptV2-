import { formaterNombre } from '../../../../core/format/nombre';
import type { ResultatCercles } from './bilan';
import type { Avertissement } from './conversion';
import type { Maille, Plateforme, PlateformeGeo } from './plateformes';

/**
 * ⑤ Jeu de zones — ce que l'écran DIT d'une plateforme et d'une maille (lot 5, T10) : noms, unités, messages. PUR,
 * sans import d'Angular. Une table par maille (`Record<Maille, …>`), jamais un ternaire cp/iris : celui du lot 4
 * (`outil-couverture`, `tableau-couverture-zone`) appellerait une commune « code postal ».
 *
 * Aucune limite de plateforme ici (§ 16.2-3) : les chiffres d'un avertissement viennent de `verifierLimites`, qui
 * les lit dans `plateformes_geo` ; `tests/unit/angular/conversion-paritaire.test.ts` balaie aussi ce dossier.
 */

/**
 * Un jeu RISQUE reçu par ⑤ : la phrase du serveur pour le cas inverse (`OU_SE_GERE.risque`, `lib/zones/charger-jeu.ts`),
 * verrouillée par `tests/unit/angular/conversion-paritaire.test.ts`.
 */
export const MESSAGE_JEU_RISQUE = 'Ce jeu de zones se gère dans le module risque.';

/** Le nom affiché de chaque plateforme. */
export const NOM_PLATEFORME: Readonly<Record<Plateforme, string>> = {
  dv360: 'DV360', ttd: 'The Trade Desk', meta: 'Meta', tiktok: 'TikTok',
};

/** Comment se dit l'unité d'une maille : au singulier, au pluriel, et dans la phrase du seuil (`mg-dilution`). */
export interface UniteMaille {
  un: string;
  plusieurs: string;
  /** Titre du bloc de seuil. */
  titre: string;
  /** Sujet de « … n'est retenu(e) que si… ». */
  sujet: string;
  accord: '' | 'e';
  /** Fin de « …une telle part de … » (`complement` de `mg-dilution`). */
  complement: string;
}

export const UNITE_MAILLE: Readonly<Record<Maille, UniteMaille>> = {
  polygone: { un: 'polygone', plusieurs: 'polygones', titre: 'Dilution au polygone', sujet: 'Un polygone', accord: '', complement: 'son polygone' },
  cp: { un: 'code postal', plusieurs: 'codes postaux', titre: 'Dilution au code postal', sujet: 'Un code postal', accord: '', complement: 'son code postal' },
  iris: { un: 'IRIS', plusieurs: 'IRIS', titre: 'Dilution à l’IRIS', sujet: 'Un IRIS', accord: '', complement: 'son IRIS' },
  commune: { un: 'commune', plusieurs: 'communes', titre: 'Dilution à la commune', sujet: 'Une commune', accord: 'e', complement: 'sa commune' },
  departement: { un: 'département', plusieurs: 'départements', titre: 'Dilution au département', sujet: 'Un département', accord: '', complement: 'son département' },
  cercle: { un: 'cercle', plusieurs: 'cercles', titre: 'Dilution au cercle', sujet: 'Un cercle', accord: '', complement: 'son cercle' },
  pays: { un: 'pays', plusieurs: 'pays', titre: 'Dilution au pays', sujet: 'Un pays', accord: '', complement: 'son pays' },
};

/** Le libellé accessible de la réglette de seuil d'une maille. */
export function libelleCurseurSeuil(maille: Maille): string {
  return `Part minimale de la population de chaque ${UNITE_MAILLE[maille].un} en zone`;
}

/** « 1 code postal » / « 12 codes postaux ». */
export function nombreUnites(n: number, maille: Maille): string {
  return `${formaterNombre(n)} ${n > 1 ? UNITE_MAILLE[maille].plusieurs : UNITE_MAILLE[maille].un}`;
}

/**
 * Un avertissement de `verifierLimites`, en français. Les deux chiffres viennent de la ligne de `plateformes_geo` et
 * du bilan : modifier le registre change la phrase sans livraison (Review Focus 5).
 */
export function texteAvertissement(a: Avertissement, maille: Maille): string {
  if (a.code === 'max_unites') {
    return `${nombreUnites(a.valeur, maille)} pour ${formaterNombre(a.limite)} admis par la plateforme${maille === 'cercle' ? ' : augmentez le rayon ou le seuil' : ''}.`;
  }
  return `Palier sous ${formaterNombre(a.limite)} personnes : ${formaterNombre(a.valeur)} achetées, la plateforme peut refuser la diffusion.`;
}

/**
 * Le refus `trop_de_cercles` du pavage, CHIFFRÉ (E4, ⑤ finitions T5) : le corps porte `n_cercles` et `plafond`
 * (sql/276), dits par la phrase de l'avertissement `max_unites` — « 481 cercles pour 200 admis par la plateforme :
 * augmentez le rayon ou le seuil. », sans seconde phrase. `null` pour tout autre corps (la phrase du serveur reste).
 */
export function texteTropDeCercles(corps: unknown): string | null {
  const c = corps as { refus?: unknown; n_cercles?: unknown; plafond?: unknown } | null;
  if (c?.refus !== 'trop_de_cercles' || typeof c.n_cercles !== 'number' || typeof c.plafond !== 'number') return null;
  return texteAvertissement({ code: 'max_unites', limite: c.plafond, valeur: c.n_cercles }, 'cercle');
}

/**
 * Une unité d'une plateforme au pays : « La Réunion (RE) · 884 165 habitants ». Un territoire non carroyé (Guadeloupe,
 * Guyane, Mayotte : Filosofi 2021) se dit « population non carroyée », jamais « 0 habitant » (E10).
 */
export function texteUnitePays(u: { code: string; nom: string; population: number | null }): string {
  return `${u.nom} (${u.code}) · ${u.population === null ? 'population non carroyée' : `${formaterNombre(u.population)} habitants`}`;
}

/** Pourquoi un pavage en cercles ne retient rien (`motif_vide`, sql/276) — trois causes, trois phrases. */
export const MESSAGE_MOTIF_VIDE: Readonly<Record<NonNullable<ResultatCercles['motif_vide']>, string>> = {
  territoire_non_carroye: 'Le carroyage Filosofi ne couvre pas ce territoire : aucun habitant chiffrable. Ce n’est pas une population nulle, c’est une donnée absente à la source.',
  aucun_carreau: 'Aucun carreau habité dans la zone : rien à couvrir.',
  aucune_cellule_au_seuil: 'Aucun cercle n’atteint le seuil : baissez le seuil ou changez le rayon.',
};

/** Mètres par kilomètre : la réglette de rayon s'affiche en km, le choix se garde en mètres. */
export const M_PAR_KM = 1e3;

/**
 * Les bornes de la réglette de rayon : celles de la ligne de la plateforme ; une borne absente (ligne « à vérifier »
 * sans rayon relevé) prend la plus large connue du registre, à défaut le rayon courant — jamais un nombre écrit ici.
 * Le pas : un demi-kilomètre.
 */
export function bornesRayon(ligne: PlateformeGeo | undefined, registre: readonly PlateformeGeo[], actuel: number): { min: number; max: number; pas: number } {
  const mins = registre.map((l) => l.limites.rayon_min_m).filter((v): v is number => v !== undefined);
  const maxs = registre.map((l) => l.limites.rayon_max_m).filter((v): v is number => v !== undefined);
  const min = ligne?.limites.rayon_min_m ?? (mins.length > 0 ? Math.min(...mins) : actuel);
  const max = ligne?.limites.rayon_max_m ?? (maxs.length > 0 ? Math.max(...maxs) : actuel);
  return { min, max: Math.max(min, max), pas: M_PAR_KM / 2 };
}

/** « 14/10/2026 » : la date d'un relevé de `plateformes_geo` (une date sans heure, lue sans fuseau). */
export function dateReleve(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split('-');
  return a && m && j ? `${j}/${m}/${a}` : iso;
}
