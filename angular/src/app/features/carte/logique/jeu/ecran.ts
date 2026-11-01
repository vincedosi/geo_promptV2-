import { formaterNombre } from '../../../../core/format/nombre';
import type { ResultatCercles } from './bilan';
import type { Avertissement, Resume } from './conversion';
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
  // « à vérifier » À CÔTÉ de la valeur non confirmée (amendement E9), pas sur la carte entière.
  const limite = `${formaterNombre(a.limite)}${a.a_verifier ? ' (à vérifier)' : ''}`;
  if (a.code === 'multiplicateur_min' || a.code === 'multiplicateur_max') {
    // A1 : des multiplicateurs du plan CP ramenés à la plage du mécanisme de poids (`plateformes_poids`) — avant, après.
    const extreme = a.code === 'multiplicateur_max' ? 'maximum' : 'minimum';
    const n = a.n ?? 1;
    return `${nombreUnites(n, maille)} ${n > 1 ? 'ramenés' : 'ramené'} à ×${limite}, le ${extreme} admis par la plateforme (×${formaterNombre(a.valeur)} calculé${n > 1 ? ' au plus extrême' : ''}).`;
  }
  if (a.code === 'nb_max_entrees') {
    // A1 : une limite d'entrées par envoi, comptée en codes envoyés ; au-delà, le plan part en plusieurs envois.
    return `${nombreUnites(a.valeur, maille)} pour ${limite} par envoi${a.mecanisme === 'script' ? ' au script de custom bidding' : ''} : découpés en ${formaterNombre(a.n ?? 1)} envois.`;
  }
  if (a.code === 'disque_hors_france') {
    // A3 : avant (le cercle se disait exact, 100 % du disque compté) → après (la part en France, la perte calculée).
    return `Disque partiellement hors de France : ${formaterNombre(a.valeur)} % de sa surface est en France, `
      + `${formaterNombre(Math.round((a.limite - a.valeur) * 10) / 10)} % en mer ou à l’étranger, achetés par la plateforme sans être comptés. `
      + 'Cercle exact → non exact : la perte est calculée. Restreignez la campagne au pays FR.';
  }
  if (a.code === 'perte_simplification') {
    // A7 : la forme envoyée en maille polygone a été simplifiée ; la part de la zone hors de la forme envoyée, et son seuil.
    return `Polygone simplifié avant l’envoi : ${formaterNombre(a.n ?? 0)} habitants de la zone (${formaterNombre(a.valeur)} %) `
      + `sont hors de la forme envoyée (perte dite au-delà de ${formaterNombre(a.limite)} %).`;
  }
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
 * Guyane, Mayotte : Filosofi 2021) se dit « population inconnue (non carroyée) » (A4, ARB-3), jamais « 0 habitant » (E10).
 */
export function texteUnitePays(u: { code: string; nom: string; population: number | null }): string {
  return `${u.nom} (${u.code}) · ${u.population === null ? 'population inconnue (non carroyée)' : `${formaterNombre(u.population)} habitants`}`;
}

/**
 * A4 (ARB-3) : la valeur de la ligne « Diffusion à population inconnue » du bilan — les unités achetées sans population
 * connue (territoire non carroyé), comptées dans aucun chiffre d'habitants. `null` s'il n'y en a pas (pas de ligne).
 */
export function texteDiffusionInconnue(n: number | undefined, maille: Maille): string | null {
  return n ? `${nombreUnites(n, maille)}, acheté${UNITE_MAILLE[maille].accord}${n > 1 ? 's' : ''} sans chiffre d’habitants` : null;
}

/**
 * A6 (sql/311) : la note du bilan d'un pavage en cercles — la somme des cercles (populations des DISQUES) dépasse la
 * diffusion achetée, comptée une fois par habitant sur l'union des disques. `null` sans chevauchement, ou pour une
 * autre maille (pas de `somme_disques`).
 */
export function texteChevauchement(resume: Resume): string | null {
  if (resume.exacte || resume.somme_disques === undefined || resume.somme_disques <= resume.achetee) return null;
  return `Les disques voisins se chevauchent : la somme des cercles (${formaterNombre(resume.somme_disques)} habitants) `
    + `dépasse la diffusion achetée (${formaterNombre(resume.achetee)}), où chaque habitant n’est compté qu’une fois.`;
}

/** Pourquoi un pavage en cercles ne retient rien (`motif_vide`, sql/276, sql/310) — quatre causes, quatre phrases. */
export const MESSAGE_MOTIF_VIDE: Readonly<Record<NonNullable<ResultatCercles['motif_vide']>, string>> = {
  territoire_non_carroye: 'Le carroyage Filosofi ne couvre pas ce territoire : aucun habitant chiffrable. Ce n’est pas une population nulle, c’est une donnée absente à la source.',
  aucun_carreau: 'Aucun carreau habité dans la zone : rien à couvrir.',
  carreaux_tous_ecartes: 'Tous les carreaux de la zone comptent moins de ménages que le minimum (valeurs imputées par l’INSEE) : rien à couvrir pour cette cible.',
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
