import { formaterNombre } from '../../../../core/format/nombre';
import type { DefautAffiche, ResultatCercles } from './bilan';
import { type Avertissement, NOMS_PAYS, type Resume } from './conversion';
import type { DefautExplique, ModePoussee, Simulation } from './conversion-defaut';
import type { Maille, Plateforme, PlateformeGeo } from './plateformes';
import { DIVISEUR_RAYON_SURFACE, PAS_RAYON_M, type RayonDefaut, bornesDeReglette } from './mailles-url';

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

/** Un pourcentage de la ligne du défaut : tel que calculé (au dixième), « — » sans valeur. */
const pourcent = (v: number | null) => (v === null ? '—' : `${formaterNombre(v)} %`);

/**
 * B16 : comment la maille part chez la plateforme (`modePoussee`, d'après `plateformes_geo.poussee_branchee` et
 * `plateformes_poids.branche`), tel que la ligne du défaut le dit.
 */
export const LIBELLE_POUSSEE: Readonly<Record<ModePoussee, string>> = {
  api: 'poussée API', ciblage_api: 'ciblage par API, poids en export manuel', manuel: 'export manuel',
};

/**
 * B9 (ARB-7, Q7 = A) : la ligne qui explique le défaut retenu, avec SES deux chiffres et ceux de la meilleure autre
 * maille simulée — « Cercles par défaut (export manuel) : couverture 91 %, taux utile 71 %, contre 10 % / 95 % en
 * codes postaux (poussée API). » (couverture / taux utile). B16 : le mode de poussée de chacune entre parenthèses.
 * Sous la cible : la raison le dit. Provisoire ou sans simulation : la phrase le dit. Revue T6 (I-7) : une simulation
 * TRANSITOIREMENT en échec (429, réseau) garde le défaut provisoire et dit pourquoi ; une maille refusée se dit à la fin.
 */
export function texteDefaut(d: DefautAffiche): string {
  const transitoires = (d.echecs ?? []).filter((e) => e.transitoire);
  const refus = (d.echecs ?? []).filter((e) => !e.transitoire)
    .map((e) => ` ${capitale(UNITE_MAILLE[e.maille].plusieurs)} écartés du choix : ${e.message}`).join('');
  if (d.critere === 'en_attente' && transitoires.length > 0) {
    const en = transitoires.map((e) => UNITE_MAILLE[e.maille].plusieurs).join(', ');
    return `${nomDefaut(d)}, provisoirement : la simulation en ${en} a échoué. ${transitoires.map((e) => e.message).join(' ')}${refus}`;
  }
  return `${texteDefautSeul(d)}${refus}`;
}

const capitale = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const nomDefaut = (d: DefautExplique) => `${capitale(UNITE_MAILLE[d.maille].plusieurs)} par défaut (${LIBELLE_POUSSEE[d.poussee]})`;

function texteDefautSeul(d: DefautExplique): string {
  const Nom = nomDefaut(d);
  if (d.critere === 'en_attente') return `${Nom}, provisoirement : simulation des autres mailles en cours.`;
  if (d.critere === 'sans_simulation' || !d.simulation) {
    return `${Nom}, faute de simulation : la plus sûre, puis exacte, puis poussée par API, puis la plus fine.`;
  }
  const chiffres = (s: Simulation) => `couverture ${pourcent(s.couverture)}, taux utile ${pourcent(s.taux_utile)}`;
  const c = d.comparee;
  const contre = c
    ? `, contre ${pourcent(c.simulation.couverture)} / ${pourcent(c.simulation.taux_utile)} en ${UNITE_MAILLE[c.maille].plusieurs} (${LIBELLE_POUSSEE[c.poussee]})`
    : '';
  const raison = d.critere === 'couverture_max' ? ` (aucune maille n’atteint ${pourcent(d.couverture_cible)} de couverture)` : '';
  return `${Nom} : ${chiffres(d.simulation)}${contre}${raison}.`;
}

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
      // Revue T6 (I-4) : un DROM est ciblé comme un pays distinct (Q-2) — « FR » couperait l'audience d'un rayon à La Réunion.
      + 'Cercle exact → non exact : la perte est calculée. Restreignez la campagne au pays du territoire : FR en métropole, '
      + `sinon le DROM, ciblé comme un pays distinct (${Object.keys(NOMS_PAYS).filter((k) => k !== 'FR').join(', ')}).`;
  }
  if (a.code === 'rayon_min' || a.code === 'rayon_max') {
    // B8 (ARB-5) : le rayon de la recette hors des bornes de la plateforme — avant, après, la borne ; la recette, elle,
    // n'est pas modifiée. Un rayon choisi autre que la borne se dit aussi (« sous le minimum… : cercles de 3 km »).
    const extreme = a.code === 'rayon_min' ? 'minimum' : 'maximum';
    // C29 : la borne de la catégorie d'annonces spéciale se nomme ; un rayon CHOISI hors bornes est un refus.
    const qui = `${extreme} ${a.plateforme ? NOM_PLATEFORME[a.plateforme] : 'de la plateforme'}${a.categorie_speciale ? ' en catégorie d’annonces spéciale' : ''}`;
    const apres = a.rayon_m ?? a.limite;
    if (a.refus) {
      return `Rayon choisi de ${distance(a.valeur)} hors des bornes (${qui} ${distance(a.limite)}${a.a_verifier ? ', à vérifier' : ''}) : `
        + `l’extraction le refuse ; passez à ${distance(apres)}.`;
    }
    const suite = 'maille non exacte, perte calculée.';
    return apres === a.limite
      ? `Rayon ajusté de ${distance(a.valeur)} à ${distance(apres)} (${qui}${a.a_verifier ? ', à vérifier' : ''}) : ${suite}`
      : `Rayon de la recette (${distance(a.valeur)}) hors des bornes : ${qui} ${distance(a.limite)}${a.a_verifier ? ' (à vérifier)' : ''}, `
        + `cercles de ${distance(apres)} : ${suite}`;
  }
  if (a.code === 'perte_simplification') {
    // A7 : la forme envoyée en maille polygone a été simplifiée ; la part de la zone hors de la forme envoyée, et son seuil.
    return `Polygone simplifié avant l’envoi : ${formaterNombre(a.n ?? 0)} habitants de la zone (${formaterNombre(a.valeur)} %) `
      + `sont hors de la forme envoyée (perte dite au-delà de ${formaterNombre(a.limite)} %).`;
  }
  if (a.code === 'groupes_cp_partiels') {
    // B15 : un groupe de CP indiscernables présent en partie dans la liste, acheté entier — avant (codes de la liste),
    // après (la liste plus les seuls membres ajoutés par ces groupes, round 1 M-1 : pas les CP voisins), exacte → calculée.
    const n = a.n ?? 1;
    return `${formaterNombre(n)} ${n > 1 ? 'groupes' : 'groupe'} de codes postaux indiscernables présent${n > 1 ? 's' : ''} en partie dans la liste, `
      + `acheté${n > 1 ? 's' : ''} ${n > 1 ? 'entiers' : 'entier'} : ${formaterNombre(a.limite)} codes de la liste → ${formaterNombre(a.valeur)} `
      + `avec ${n > 1 ? 'les groupes entiers' : 'le groupe entier'}. Maille non exacte : la perte est calculée.`;
  }
  if (a.code === 'max_unites') {
    const avant = `${nombreUnites(a.valeur, maille)} pour ${formaterNombre(a.limite)} admis par la plateforme`;
    // B14 (ARB-6) : une maille découpée (`n` blocs) — annoncé, avec la taille de chaque bloc (avant : un seul envoi).
    if (a.n !== undefined && a.n > 1) return `${avant} : découpage automatique en ${formaterNombre(a.n)} blocs, triés par part décroissante (${taillesBlocs(a)}).`;
    return `${avant}${maille === 'cercle' ? ' : augmentez le rayon ou le seuil' : ''}.`;
  }
  if (a.code === 'pop_min_unite') return textePopMinUnite(a, maille, limite);
  // B14 round 1 (I-1) : le minimum d'UN bloc du découpage — le bloc est nommé en tête.
  if (a.bloc !== undefined) {
    const { bloc, ...groupe } = a;
    const texte = texteAvertissement(groupe, maille);
    return `Bloc ${formaterNombre(bloc)} : ${texte.charAt(0).toLowerCase()}${texte.slice(1)}`;
  }
  if (a.non_verifiable) {
    // Relecture B13 (I-2) : une part inconnue — jamais un refus ; la part connue est dite.
    return `Minimum de ${limite} personnes par groupe non vérifiable (${nombreUnites(a.n ?? 1, maille)} à population inconnue) : `
      + `${formaterNombre(a.valeur)} personnes connues.`;
  }
  // B13 : le minimum du groupe — refus ou avertissement, selon le registre.
  return a.refus
    ? `Refusé : ${formaterNombre(a.valeur)} personnes achetées, sous le minimum de ${limite} par groupe de la plateforme : élargissez la zone ou choisissez une autre maille.`
    : `Palier sous ${limite} personnes : ${formaterNombre(a.valeur)} achetées, la plateforme peut refuser la diffusion.`;
}

/**
 * B14 : la taille des blocs d'un découpage — « 3 000 + 500 » ; au-delà de trois blocs, « 3 × 3 000 + 500 ». Les blocs
 * pleins portent la limite, le dernier le reste (`decouperEnBlocs`, une unité par entrée).
 */
export function taillesBlocs(a: Pick<Avertissement, 'limite' | 'valeur'> & { n?: number }): string {
  const n = a.n ?? Math.ceil(a.valeur / a.limite);
  const dernier = a.valeur - (n - 1) * a.limite;
  // Relecture B14 (M-1) : un multiple exact de la limite se dit « 5 × 1 000 », pas « 4 × 1 000 + 1 000 ».
  if (n > 3 && dernier === a.limite) return `${formaterNombre(n)} × ${formaterNombre(a.limite)}`;
  if (n > 3) return `${formaterNombre(n - 1)} × ${formaterNombre(a.limite)} + ${formaterNombre(dernier)}`;
  return [...Array.from({ length: n - 1 }, () => a.limite), dernier].map((v) => formaterNombre(v)).join(' + ');
}

/**
 * B13 : le minimum de population PAR UNITÉ (`controlerPopulation`, `avertissementsEcartes`) — cercles écartés au
 * pavage (avant : ces cercles au seuil, après : écartés), refus du registre (le cercle exact unique de 1 km à 300
 * habitants chez DV360), ou avertissement. `limite` porte déjà « (à vérifier) » (E9).
 */
function textePopMinUnite(a: Avertissement, maille: Maille, limite: string): string {
  const n = a.n ?? 1;
  const par = maille === 'cercle' ? 'cercle' : UNITE_MAILLE[maille].un;
  // Relecture B13 (I-1) : population inconnue (territoire non carroyé), jamais « 0 habitant ».
  if (a.non_verifiable) return `Population inconnue, minimum non vérifiable : ${nombreUnites(n, maille)} à population inconnue (minimum de ${limite} habitants par ${par}).`;
  if (a.ecartes) {
    return `${nombreUnites(n, maille)} au seuil ${n > 1 ? 'écartés' : 'écarté'} : moins de ${limite} habitants, le minimum par ${par} de la plateforme `
      + `(${n > 1 ? 'le plus peuplé' : 'il'} : ${formaterNombre(a.valeur)}).${a.refus ? ' Aucun cercle ne reste : élargissez le rayon ou baissez le seuil.' : ''}`;
  }
  const qui = n === 1
    ? `${maille === 'cercle' ? 'Le cercle compte' : `1 ${UNITE_MAILLE[maille].un} compte`} ${formaterNombre(a.valeur)} habitants`
    : `${nombreUnites(n, maille)} sous ${limite} habitants (le moins peuplé : ${formaterNombre(a.valeur)})`;
  return a.refus
    ? `Refusé : ${qui.charAt(0).toLowerCase()}${qui.slice(1)}, sous le minimum de ${limite} par ${par} de la plateforme : élargissez le rayon ou choisissez une autre maille.`
    : `${qui}, sous le minimum de ${limite} par ${par} de la plateforme : elle peut refuser leur diffusion.`;
}

/**
 * A7 (tour 1) : la simplification figée d'un polygone, dite dans la liste des versions de ⑤ — « simplifié à 50 m :
 * 66 000 → 18 000 sommets, 400 habitants de la zone perdus, 30 hors zone inclus ». D37 (sql/340) : les morceaux de
 * moins d'un carreau retirés se disent après les sommets — « 3 morceaux de moins de 0,04 km² retirés ». `null` sans
 * simplification (tolérance 0, extraction d'avant A7, ou forme envoyée identique à la zone : rien retiré à 50 m).
 */
export function texteSimplification(s: {
  tolerance_m: number; sommets_avant: number; sommets: number; perdue: number; gagnee: number;
  morceau_min_km2?: number; morceaux_retires?: number;
} | undefined): string | null {
  if (!s || !(s.tolerance_m > 0)) return null;
  const retires = s.morceaux_retires ?? 0;
  if (s.sommets === s.sommets_avant && retires === 0) return null;
  return `simplifié à ${formaterNombre(s.tolerance_m)} m : ${formaterNombre(s.sommets_avant)} → ${formaterNombre(s.sommets)} sommets, `
    + (retires > 0 ? `${formaterNombre(retires)} morceaux de moins de ${formaterNombre(s.morceau_min_km2)} km² retirés, ` : '')
    + `${formaterNombre(s.perdue)} habitants de la zone perdus, ${formaterNombre(s.gagnee)} hors zone inclus`;
}

/**
 * B14 : le découpage figé d'une extraction, dit dans la liste des versions de ⑤ — « 2 blocs de 3 000 au plus : bloc 1
 * 3 000 (taux d'utile 52,1 %), bloc 2 500 (31,4 %) ». `null` sans découpage (extraction d'avant B14, ou sous la limite).
 */
export function texteBlocs(d: { limite: number; blocs: readonly { numero: number; n_unites: number; taux_utile: number | null }[] } | undefined): string | null {
  if (!d || d.blocs.length < 2) return null;
  const blocs = d.blocs.map((b, i) => `bloc ${b.numero} ${formaterNombre(b.n_unites)}`
    + (b.taux_utile === null ? '' : ` (${i === 0 ? 'taux d’utile ' : ''}${formaterNombre(b.taux_utile)} %)`));
  return `${formaterNombre(d.blocs.length)} blocs de ${formaterNombre(d.limite)} au plus : ${blocs.join(', ')}`;
}

/**
 * Le refus `trop_de_cercles` du pavage, CHIFFRÉ (E4, ⑤ finitions T5) : le corps porte `n_cercles` et `plafond`
 * (sql/276), dits par la phrase de l'avertissement `max_unites` — « 481 cercles pour 200 admis par la plateforme :
 * augmentez le rayon ou le seuil. », sans seconde phrase. `null` pour tout autre corps (la phrase du serveur reste).
 */
export function texteTropDeCercles(corps: unknown): string | null {
  const c = corps as { refus?: unknown; n_cercles?: unknown; plafond?: unknown; sans_proposition?: { motif?: unknown; rayon_max_m?: unknown } } | null;
  if (c?.refus !== 'trop_de_cercles' || typeof c.n_cercles !== 'number' || typeof c.plafond !== 'number') return null;
  const avant = `${nombreUnites(c.n_cercles, 'cercle')} pour ${formaterNombre(c.plafond)} admis par la plateforme`;
  // B10 : le plus petit rayon qui passe, proposé (avant : ce rayon refusé ; après : le rayon proposé et ses cercles).
  const p = rayonPropose(corps);
  if (p) {
    const i = texteInterruption(corps);
    if (i) return `${avant}. Rayon sous le plafond : ${distance(p.rayon_m)} (${nombreUnites(p.n_cercles, 'cercle')}) ; ${i.charAt(0).toLowerCase()}${i.slice(1)}`;
    return p.au_pas
      ? `${avant}. Plus petit rayon sous le plafond : ${distance(p.rayon_m)} (${nombreUnites(p.n_cercles, 'cercle')}).`
      : `${avant}. Rayon sous le plafond : ${distance(p.rayon_m)} (${nombreUnites(p.n_cercles, 'cercle')}) ; un plus petit peut passer.`;
  }
  const i = texteInterruption(corps);
  if (i) return `${avant}. ${i}`;
  const s = c.sans_proposition;
  if (s?.motif === 'aucun_sous_plafond' && typeof s.rayon_max_m === 'number') {
    return `${avant}, et encore trop jusqu’au rayon maximal (${distance(s.rayon_max_m)}) : relevez le seuil ou réduisez la zone.`;
  }
  return texteAvertissement({ code: 'max_unites', limite: c.plafond, valeur: c.n_cercles }, 'cercle');
}

/**
 * Tour 1 de B10 (I-1) : la recherche du rayon proposé arrêtée par sa garde (`interrompue`) — « Recherche interrompue
 * (quota de calculs atteint) : dernier rayon essayé 11,5 km (379 cercles). » ; `null` sans interruption.
 */
function texteInterruption(corps: unknown): string | null {
  const i = (corps as { interrompue?: { cause?: unknown; dernier_rayon_m?: unknown; dernier_n_cercles?: unknown } } | null)?.interrompue;
  if (!i || (i.cause !== 'quota' && i.cause !== 'temps') || typeof i.dernier_rayon_m !== 'number' || typeof i.dernier_n_cercles !== 'number') return null;
  const cause = i.cause === 'quota' ? 'quota de calculs atteint, réessayez dans une minute' : 'temps de calcul épuisé';
  return `Recherche interrompue (${cause}) : dernier rayon essayé ${distance(i.dernier_rayon_m)} (${nombreUnites(i.dernier_n_cercles, 'cercle')}).`;
}

/** B10 : le rayon proposé par le serveur avec un refus `trop_de_cercles` (`rayon_propose`), ou `null`. */
export function rayonPropose(corps: unknown): { rayon_m: number; n_cercles: number; au_pas: boolean } | null {
  const p = (corps as { refus?: unknown; rayon_propose?: { rayon_m?: unknown; n_cercles?: unknown; au_pas?: unknown } | null } | null);
  const r = p?.refus === 'trop_de_cercles' ? p.rayon_propose : null;
  return r && typeof r.rayon_m === 'number' && typeof r.n_cercles === 'number'
    ? { rayon_m: r.rayon_m, n_cercles: r.n_cercles, au_pas: r.au_pas === true } : null;
}

/**
 * B10 : la ligne qui dit d'où vient le rayon par défaut tiré de la SURFACE de la zone (avant : le rayon calculé ;
 * après : le rayon réglé, et la borne de la plateforme qui l'a ramené) — « Rayon par défaut 1 km : 840 m tiré de la
 * surface (√(surface / π) / 3 pour 20 km²), ramené au minimum de Meta. » Le repli (surface inconnue) se dit
 * aussi. `null` pour le rayon de la recette : son ajustement est l'avertissement `rayon_min` / `rayon_max` (B8).
 */
/** m-2 : sous cette surface (km²), la ligne du rayon par défaut la dit au dixième. */
const SURFACE_AU_DIXIEME_KM2 = 10;

export function texteRayonDefaut(d: RayonDefaut, plateforme: Plateforme): string | null {
  if (d.source === 'recette') return null;
  if (d.source === 'repli') return `Rayon par défaut ${distance(d.rayon_m)} : surface de la zone inconnue.`;
  // m-2 : sous 10 km², la surface au dixième — jamais « pour 0 km² ».
  const s = d.surface_km2 ?? 0;
  const calcul = `√(surface / π) / ${DIVISEUR_RAYON_SURFACE} pour ${formaterNombre(s < SURFACE_AU_DIXIEME_KM2 ? Math.round(s * 10) / 10 : Math.round(s))} km²`;
  if (!d.borne) return `Rayon par défaut ${distance(d.rayon_m)} : ${calcul} (${distance(d.calcule_m)}).`;
  const extreme = d.borne === 'rayon_min_m' ? 'minimum' : 'maximum';
  const qui = d.borne_reglette ? 'de la réglette (plus petit minimum du registre)' : `de ${NOM_PLATEFORME[plateforme]}`;
  if (d.borne_reglette && d.borne === 'rayon_max_m') {
    return `Rayon par défaut ${distance(d.rayon_m)} : ${distance(d.calcule_m)} tiré de la surface (${calcul}), ramené au maximum de la réglette (plus grand maximum du registre).`;
  }
  return `Rayon par défaut ${distance(d.rayon_m)} : ${distance(d.calcule_m)} tiré de la surface (${calcul}), ramené au ${extreme} ${qui}.`;
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

/** « 500 m », « 1 km », « 2,5 km » : un rayon en mètres, dit dans un avertissement (B8). */
/**
 * C29 : ce que la case « catégorie d'annonces spéciale » impose, lu au registre (`rayon_min_categorie_speciale`) —
 * « Rayon minimal des cercles en catégorie spéciale : Meta 15 km. » ; `null` si aucune plateforme n'en porte.
 */
export function texteCategorieSpeciale(registre: readonly PlateformeGeo[]): string | null {
  const bornes = registre.filter((l) => l.limites.rayon_min_categorie_speciale !== undefined)
    .map((l) => `${NOM_PLATEFORME[l.plateforme]} ${distance(l.limites.rayon_min_categorie_speciale as number)}`
      // C29 round 1 : « à vérifier » à côté de la valeur (amendement E9) — la source est une note, pas un relevé.
      + ((l.parametres_a_verifier ?? []).includes('rayon_min_categorie_speciale') ? ' (à vérifier)' : ''));
  return bornes.length ? `Rayon minimal des cercles en catégorie spéciale : ${bornes.join(', ')}.` : null;
}

function distance(m: number): string {
  return m >= M_PAR_KM ? `${formaterNombre(m / M_PAR_KM)} km` : `${formaterNombre(m)} m`;
}

/**
 * Les bornes de la réglette de rayon : celles de la ligne de la plateforme ; une borne absente (ligne « à vérifier »
 * sans rayon relevé) prend la plus large connue du registre, à défaut le rayon courant — jamais un nombre écrit ici.
 * Le pas : `PAS_RAYON_M` (un demi-kilomètre, le pas des rayons proposés par le serveur, B10).
 */
export function bornesRayon(ligne: PlateformeGeo | undefined, registre: readonly PlateformeGeo[], actuel: number): { min: number; max: number; pas: number } {
  // Tour 1 de B10 (I-2) : la règle des bornes est `bornesDeReglette`, partagée avec le rayon par défaut.
  const b = bornesDeReglette(ligne, registre);
  const min = b.min ?? actuel;
  return { min, max: Math.max(min, b.max ?? actuel), pas: PAS_RAYON_M };
}

/** « 14/10/2026 » : la date d'un relevé de `plateformes_geo` (une date sans heure, lue sans fuseau). */
export function dateReleve(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split('-');
  return a && m && j ? `${j}/${m}/${a}` : iso;
}
