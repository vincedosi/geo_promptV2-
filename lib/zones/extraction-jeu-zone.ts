/**
 * @file lib/zones/extraction-jeu-zone.ts — l'extraction d'un jeu de ZONE (lot 5, T8 ; arbitrages A-2, A-11). Appelé
 * par `POST /api/zones/jeux/[id]/extractions` quand le jeu est de type `zone` (le jeu risque garde son chemin).
 *
 * LE SERVEUR REJOUE TOUT (Review Focus 3). Le client n'envoie que l'origine et un commentaire ; les unités de chaque
 * plateforme sont recalculées ici à partir du jeu ENREGISTRÉ (zone, cible, mode de plan, choix par plateforme) :
 * - maille EXACTE pour la recette (`exactitude`, A-6 ; ruling du contrôleur, relecture T8) : la géométrie de la
 *   RECETTE est figée, sans calcul ni seuil — le polygone (la forme est copiée par la RPC), LE cercle d'un
 *   `rayon_point` (si le rayon choisi est absent ou égal à celui de la recette, et le disque entier en France — A3,
 *   sinon il se pave et l'avertissement `disque_hors_france` est figé), les UNITÉS CONSTITUTIVES dans leur maille (B15) ;
 *   résumé à zéro perte (`resumeExact`), chiffré par la population de la zone (`forme`) ;
 * - maille territoriale calculée (`cp`, `commune`, `departement`, `iris`) : `couverture_zone` (servie du cache tant
 *   que la zone et la base n'ont pas changé) puis `appliquerSeuil` — la MÊME fonction que l'écran (A-5) ; toutes les
 *   unités touchées partent, marquées `retenu` par `estRetenue` ;
 * - cercle calculé : `paver_cercles` aux limites de la plateforme (seules les cellules retenues sont rendues) ;
 * - PAYS, pour une zone pays (⑤ finitions, A-6) : une unité par code de `plateformes_geo.codes_pays` — FIGÉE ici, une
 *   `update` de la table ne change pas une extraction relue —, chiffrée par la couverture « telle quelle » de la zone
 *   et, si un DROM est ciblé, par sa couverture par département (`unitesPays`) : AUCUN carreau lu (dénominateurs
 *   nationaux, sql/296). Mesuré le 30/10 sur « France entière » : forme 4,1 ms · 874 accès, départements 5,8 ms ·
 *   1 279 accès, puis servies du cache (0,4 et 1,0 ms) ; « France métropolitaine » ne lit que la forme.
 * Une maille SANS OBJET pour la recette (`mailleSansObjet` : cercles ou commune sur une zone pays, pays sur une zone
 * locale) refuse l'extraction (422 `maille_sans_objet`) avant toute lecture : un jeu enregistré avant la règle.
 * Les conversions sont SÉQUENTIELLES (jamais en parallèle : chacune peut lire ≈ 100 000 accès), et un découpage lu
 * pour une plateforme sert les suivantes (deux plateformes au CP ne lisent la couverture qu'une fois).
 *
 * LES PLANS CP. B12 : chaque plateforme au CP a SON plan, à SON seuil et à la plage de SES mécanismes
 * (`plansParPlateforme`), figé dans `zone_set_extraction_cp_plateforme` (sql/317, unités retenues seulement) et son
 * bilan dans le résumé de la plateforme (`plan_cp`). Le plan COMMUN de `zone_set_extraction_cp` reste calculé au seuil
 * le PLUS BAS des plateformes au CP (décision du contrôleur, sql/278) : ⑥/⑦ le lisent encore. Exacte au CP (B15), la liste fait chaque plan.
 * ⚠ D32 (sql/334) : ce plan commun est DÉPRÉCIÉ — retiré dans le commit qui fait lire le plan par plateforme à ⑥ et ⑦
 * (côté dentsu) ; les extractions déjà produites gardent le leur, figé, en lecture seule.
 *
 * Une plateforme calculée qui ne retient AUCUNE unité refuse l'extraction (422) : un plan figé qui n'achète rien pour
 * une plateforme choisie se lirait comme un plan valable.
 */
import { NextResponse } from 'next/server';
import type { createAdminClient } from '@/lib/auth';
import type { Tables } from '@/types/database.types';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { formaterNombre } from '@/lib/format/nombre';
import { MESSAGES_REFUS_COUVERTURE, estNationaleMoins, repondreCouverture, type LigneCouverture } from './couverture';
import {
  MESSAGES_CONVERSION, appliquerSeuil, avertissementsDisque, estRetenue, exactitude, mailleSansObjet, paysAVerifier, resumeExact,
  resumePays, unitesPays, verifierLimites,
  type Avertissement, type Resume,
} from './conversion';
import { avertissementsRayon, regleCategorieSpeciale } from './conversion-rayon';
import { avertissementsComposition, unitesConstitutives } from './exactitude-composition';
import { dansLOrdreDesBlocs, decouperEnBlocs, type Decoupage } from './decoupage-blocs';
import { avertissementsEcartes, controlerPopulation, populationDeForme } from './conversion-population';
import {
  avertissementSimplification, depassementsPolygone, resumePolygoneSimplifie, type DepassementPolygone, type MesureSimplification,
} from './polygone-extraction';
import { lirePoids, lireRegles, messageRefusPopulation, paverPourPlateforme, refusDuChoix } from './conversion-serveur';
import { MESSAGE_JEU_INTROUVABLE, OU_SE_GERE } from './charger-jeu';
import type { MembresParCanonique } from './plan';
import {
  planCpDeZone, plansParPlateforme, reglageDuPlan, sortiesPoids,
  type PlanPlateforme, type ReglagePlan, type SortiePoids, type VolumesAttendus,
} from './plan-jeu-zone';
import { lireVolumesAttendus } from './part-prevue-serveur';
import { universDeZone } from './part-prevue';
import { lireGroupesCp } from './groupes';
import { lireRecette, recetteVue } from './recette-schema';
import type { PlateformeGeo, PlateformePoids } from './plateformes';
import type { Recette } from './recette';
import { refusActivationServeur } from './activation-serveur';

type ClientAdmin = ReturnType<typeof createAdminClient>;
type LigneJeu = Tables<'zone_sets'>;
type ModePlan = 'pondere' | 'exclusif';

const ECHEC = 'Extraction impossible.';

/** Le choix d'une plateforme, tel que `zone_set_plateformes` l'enregistre. */
interface Choix { plateforme: string; maille: string; seuil: number; rayon_m: number | null }

/** Une unité telle que `creer_extraction_jeu_zone` la reçoit (sql/278) ; un cercle ou le polygone n'a pas de code. */
interface Unite {
  plateforme: string; maille: string; retenu: boolean;
  code?: string; nom?: string | null; lon?: number; lat?: number; rayon_m?: number;
  pop_en_zone?: number | null; pop_totale?: number | null; part?: number | null;
  /** B14 (sql/319) : le bloc de l'unité retenue quand la maille dépasse sa limite d'unités (`decouperEnBlocs`). */
  bloc?: number;
}

/**
 * Le bilan d'une plateforme, figé dans `zone_set_extractions.plateformes` (la RPC y ajoute maille, seuil, rayon).
 * Les compteurs n'ont pas le même sens selon la maille, d'où des champs distincts :
 * - `n_unites` : ce qui est ACHETÉ — territoires retenus, cercles retenus, codes de la liste, ou 1 (polygone, cercle
 *   de la recette) ;
 * - `n_touchees` (maille territoriale calculée) : territoires touchés par la zone, retenus ou non ;
 * - `n_candidates` (cercles calculés) : cellules hexagonales du pavage examinées — pas des territoires.
 */
interface ResumePlateforme {
  plateforme: string; exacte: boolean; n_unites: number; avertissements: Avertissement[];
  n_touchees?: number; n_candidates?: number; population: number; surface_km2?: number;
  couverte: number; achetee: number; manques: number; hors_zone: number; taux_utile: number | null;
  /** Maille pays : le ciblage n'est pas confirmé pour CETTE recette (`paysAVerifier`, relecture 1) ; absent sinon. */
  pays_a_verifier?: true;
  /** Maille CP : les CODES achetés (groupes développés, A1) — ce que comptent les limites de la plateforme. */
  n_codes?: number;
  /** Maille CP : ce que la plateforme reçoit par chacun de ses mécanismes de poids (`plateformes_poids`, A1). */
  poids?: SortiePoids[];
  /**
   * B12 : maille CP — le bilan de SON plan (son seuil, ses unités retenues, séquence E4, part prévue), et ce que ses
   * mécanismes en feraient (`poids`, `avertissements`). Tour 1 (I-1) : `poids` et `avertissements` de la plateforme
   * restent ceux du plan COMMUN, celui que ⑥/⑦ poussent encore ; ceux-ci basculeront quand ⑥/⑦ liront son plan.
   */
  plan_cp?: { seuil: number; poids: SortiePoids[]; avertissements: Avertissement[] } & PlanPlateforme['plan']['resume'];
  /** A4 (ARB-3) : unités achetées à population inconnue (« diffusion à population inconnue ») ; absent s'il n'y en a pas. */
  n_inconnues?: number;
  /** C24 (sql/327) : maille territoriale, cible ≠ `ind` — la diffusion achetée en population totale ; absent sinon. */
  diffusion_population_totale?: number;
  /**
   * A6 (sql/311) : cercles calculés — somme des populations des DISQUES retenus (les `pop_totale` des unités), qui
   * dépasse `achetee` (union dédoublonnée) dès que des disques se chevauchent ; absent pour une autre maille.
   */
  somme_disques?: number;
  /**
   * A7 (sql/312) : maille polygone — la forme envoyée a été simplifiée (D37, sql/340 : 50 m, morceaux de moins de
   * 0,04 km² retirés) : sommets et morceaux avant / après, morceaux retirés, habitants de la zone perdus et habitants
   * hors zone gagnés. La forme figée (`zone_set_extractions.forme`) est la forme envoyée ; la zone enregistrée ne change
   * pas, et les chiffres de la zone (`population`, `couverte`…) restent ceux de la zone.
   */
  simplification?: Omit<MesureSimplification, 'simplifiee' | 'seuil_perte_affichee' | 'sous_bornes'>;
  /**
   * A5 (ARB-4, sql/310) : le minimum de ménages d'un carreau compté dans ces chiffres (0 pour la population totale),
   * figé avec le bilan — changer le réglage ensuite ne change pas ce qu'une extraction a compté.
   */
  min_menages?: number;
  /** B14 (ARB-6) : au-delà de `limites.max_unites`, la limite lue et le bilan de chaque bloc ; absent sinon. */
  decoupage?: Decoupage;
}

type Echec = { ok: false; reponse: NextResponse };
/**
 * `populations` (C24 round 1, I-1) : les populations TOTALES des unités retenues, celles que comparent les minimums de
 * la plateforme (son audience réelle) ; absent = `pop_totale` des unités (cible `ind`, où elles sont égales).
 */
type Issue = { ok: true; unites: Unite[]; resume: ResumePlateforme; populations?: (number | null)[] } | Echec;

/** Ce que `couverture_zone` rend d'utile ici (`lignes` vide pour le découpage `forme`). */
interface Couverture {
  population: number; surface_km2: number; lignes: LigneCouverture[]; min_menages?: number;
  /** C24 round 1 (sql/330) : cible ≠ `ind`, la population TOTALE de la forme. */
  population_ind?: number;
  /** B13 (relecture, I-1) : lus pour `populationDeForme` — un territoire non carroyé rend la population inconnue. */
  motif_vide?: string | null; territoires_non_carroyes?: unknown[] | null;
}

/** Ce que `paver_cercles` rend d'utile ici. */
interface Pavage {
  n_candidates: number; n_cercles: number; population: number; couverte: number; manques: number; hors_zone: number;
  achetee: number; taux_utile: number | null; min_menages?: number;
  /** A6 (sql/311) : somme des `pop_totale` des cercles (populations des disques), ≥ `achetee`. */
  somme_disques?: number;
  /** A6 : chaque cercle porte la population de son DISQUE (pas de sa cellule hexagonale). */
  /** `pop_totale_ind` (C24 round 1, sql/330) : cible ≠ `ind`, la population totale du disque. */
  cercles: { lon: number; lat: number; pop_en_zone: number; pop_totale: number; pop_totale_ind?: number; part: number }[];
  /** B13 (sql/318) : les cellules au seuil écartées par le seul minimum par cercle (`p_pop_min`). */
  ecartes_pop_min?: { n_cercles: number; population_max: number | null };
}

const erreur = (message: string, status: number): Echec => ({ ok: false, reponse: NextResponse.json({ error: message }, { status }) });

function panne(contexte: string, detail: unknown): Echec {
  console.error(`[zones/extractions] ${contexte} :`, detail instanceof Error ? detail.message : detail);
  return erreur(ECHEC, 500);
}

/** Un refus de RPC (déjà traduit par `repondreCouverture`) préfixé de la plateforme qui l'a provoqué, même statut. */
async function refusDe(plateforme: string, reponse: NextResponse): Promise<Echec> {
  const corps = (await reponse.json()) as Record<string, unknown>;
  return {
    ok: false,
    reponse: NextResponse.json({ ...corps, plateforme, error: `${plateforme} — ${String(corps.error)}` }, { status: reponse.status }),
  };
}

const aucuneUnite = (c: Choix) =>
  erreur(`${c.plateforme} — aucune unité retenue au seuil de ${formaterNombre(c.seuil)} % : baissez le seuil ou changez de maille.`, 422);

/** Le contexte d'une conversion : le jeu, la recette de sa zone (pour l'exactitude), les lectures mémorisées. */
interface Contexte {
  supabase: ClientAdmin; jeu: LigneJeu; recette: Recette | null;
  /** Revue T6 (I-2) : zone nationale moins des zones locales (C21) — cercles, communes, IRIS sans objet. */
  nationaleMoins: boolean;
  /** Un découpage lu pour une plateforme sert les suivantes (et le plan CP). */
  couvertures: Map<string, Couverture>;
}

const estEchec = (v: Couverture | Echec): v is Echec => 'ok' in v;

/** La couverture d'un découpage, lue une fois par extraction ; un refus est préfixé de la plateforme qui l'a demandée. */
async function lireCouverture(ctx: Contexte, plateforme: string, decoupage: string): Promise<Couverture | Echec> {
  const deja = ctx.couvertures.get(decoupage);
  if (deja) return deja;
  const r = await ctx.supabase.rpc('couverture_zone', {
    p_zone_id: ctx.jeu.custom_geo_zone_id ?? '', p_org_id: ctx.jeu.org_id, p_cible: ctx.jeu.cible, p_decoupage: decoupage,
  });
  const o = rpcJson<Couverture & { refus?: string }>(r.data);
  if (r.error || !o || o.refus !== undefined || typeof o.population !== 'number' || !Array.isArray(o.lignes)) {
    return refusDe(plateforme, repondreCouverture(r, MESSAGES_REFUS_COUVERTURE, 'zones/extractions couverture', ECHEC));
  }
  const couverture = {
    population: o.population, surface_km2: o.surface_km2, lignes: o.lignes, min_menages: o.min_menages,
    motif_vide: o.motif_vide ?? null, territoires_non_carroyes: o.territoires_non_carroyes ?? null,
    ...(typeof o.population_ind === 'number' ? { population_ind: o.population_ind } : {}),  // C24 round 1
  };
  ctx.couvertures.set(decoupage, couverture);
  return couverture;
}

/**
 * Une maille EXACTE : la géométrie de la recette, sans calcul ni seuil. Le résumé est celui de la zone telle quelle
 * (`resumeExact` : couverte = achetée = population, aucune perte), chiffré par le découpage `forme`.
 */
async function convertirExacte(ctx: Contexte, c: Choix, regle: PlateformeGeo): Promise<Issue> {
  const forme = await lireCouverture(ctx, c.plateforme, 'forme');
  if (estEchec(forme)) return forme;
  const r = ctx.recette;
  // B13 (relecture, I-1) : un cercle exact en territoire non carroyé a une population INCONNUE (ARB-3), jamais 0.
  const popForme = populationDeForme(forme);
  // C24 round 1 (I-1) : la population TOTALE de la forme (cible ≠ ind) — la diffusion, et ce que comparent les minimums.
  const popTotaleForme = populationDeForme({ ...forme, population: forme.population_ind ?? forme.population });
  const diffusion = forme.population_ind !== undefined ? { diffusion_population_totale: forme.population_ind } : {};
  const toute = { pop_en_zone: popForme, pop_totale: popForme, part: popForme === null ? null : 100, retenu: true };
  let unites: Unite[];
  if (c.maille === 'pays' && r?.type === 'pays') {
    // Les codes FIGÉS depuis la table (A-6) ; la couverture par département seulement si un DROM est ciblé.
    const codes = regle.codes_pays?.[r.code] ?? [];
    if (codes.length === 0) return panne('codes pays', `${c.plateforme} : aucun code pour ${r.code}`);
    const departements = codes.some((k) => k !== 'FR') ? await lireCouverture(ctx, c.plateforme, 'departement') : null;
    if (departements && estEchec(departements)) return departements;
    const pays = unitesPays(codes, forme.population, departements?.lignes ?? null);
    unites = pays.map((u) => ({
      plateforme: c.plateforme, maille: 'pays', code: u.code, nom: u.nom, retenu: true,
      pop_en_zone: u.population, pop_totale: u.population, part: u.population === null ? null : 100,
    }));
    // A4 (ARB-3) : les territoires à population inconnue sont achetés et comptés à part (`n_inconnues`).
    const bilanPays = resumePays(pays, forme.population, forme.surface_km2);
    const aVerifierPays = paysAVerifier(r, regle) ? { pays_a_verifier: true as const } : {};
    return {
      ok: true, unites,
      resume: { ...bilanPays, plateforme: c.plateforme, avertissements: verifierLimites(bilanPays, regle), ...aVerifierPays, min_menages: forme.min_menages },
    };
  } else if (unitesConstitutives(r)?.maille === c.maille) {
    // B15 : unités constitutives, seuil ignoré ; exacte au CP = sans groupe partiel, les codes de la liste sont achetés (A1).
    unites = [...new Set(unitesConstitutives(r)?.codes)].map((code) => ({ plateforme: c.plateforme, maille: c.maille, code, retenu: true }));
    // Revue T6 (I-3, ARB-3) : forme en territoire non carroyé — chaque code acheté à population inconnue, jamais 0.
    const bilanCp = {
      ...resumeExact(forme.population, forme.surface_km2, unites.length, c.maille === 'cp' ? unites.length : undefined),
      ...(popForme === null ? { n_inconnues: unites.length } : {}),
    };
    return { ok: true, unites, resume: { ...bilanCp, plateforme: c.plateforme, avertissements: verifierLimites(bilanCp, regle), min_menages: forme.min_menages } };
  } else if (c.maille === 'cercle' && r?.type === 'rayon_point') {
    unites = [{ plateforme: c.plateforme, maille: 'cercle', lon: r.lon, lat: r.lat, rayon_m: r.rayon_m, ...toute }];
  } else {
    // Le polygone : une unité sans code ; la RPC fige la forme SIMPLIFIÉE (A7), mesurée et contrôlée ici d'abord.
    const mesure = await mesurerPolygone(ctx, c.plateforme, regle);
    if (!mesure.ok) return mesure;
    const m = mesure.mesure;
    // Tour 1 (M-1) : une forme simplifiée n'est plus la zone — bilan calculé (perdue = manques, gagnée = hors zone),
    // et l'unité porte les mêmes chiffres. Sinon le bilan exact de la zone.
    const simplifie = resumePolygoneSimplifie(m, forme.population);
    // Revue T6 (I-3, ARB-3) : forme en territoire non carroyé — l'unité figée SANS population (jamais 0), comptée inconnue.
    const inconnue = popForme === null ? { n_inconnues: 1 } : {};
    const bilanPolygone = { ...(simplifie ?? resumeExact(forme.population, forme.surface_km2, 1)), ...diffusion, ...inconnue };
    unites = [{
      plateforme: c.plateforme, maille: 'polygone', retenu: true,
      ...(popForme === null ? { pop_en_zone: null, pop_totale: null, part: null }
        : simplifie ? { pop_en_zone: simplifie.couverte, pop_totale: simplifie.achetee, part: simplifie.taux_utile }
          : { pop_en_zone: forme.population, pop_totale: forme.population, part: 100 }),
    }];
    // `tolerance_m` et `morceau_min_km2` (D37) sont relus par la RPC pour figer CETTE forme (tour 1, M-2).
    const simplification = {
      tolerance_m: m.tolerance_m,
      ...(m.morceau_min_km2 !== undefined ? { morceau_min_km2: m.morceau_min_km2, morceaux_retires: m.morceaux_retires ?? 0 } : {}),
      sommets_avant: m.sommets_avant, morceaux_avant: m.morceaux_avant, sommets: m.sommets,
      morceaux: m.morceaux, perdue: m.perdue, gagnee: m.gagnee,
    };
    return {
      ok: true, unites, populations: [popTotaleForme],
      resume: {
        ...bilanPolygone, plateforme: c.plateforme, population: forme.population, surface_km2: forme.surface_km2,
        min_menages: forme.min_menages, simplification,
        avertissements: [...verifierLimites(bilanPolygone, regle), ...avertissementSimplification(m, forme.population)],
      },
    };
  }
  const bilan = { ...resumeExact(forme.population, forme.surface_km2, unites.length), ...(popForme === null ? { n_inconnues: unites.length } : {}), ...diffusion };
  const aVerifier = paysAVerifier(r, regle) ? { pays_a_verifier: true as const } : {};
  return { ok: true, unites, populations: unites.map(() => popTotaleForme), resume: { ...bilan, plateforme: c.plateforme, avertissements: verifierLimites(bilan, regle), ...aVerifier, min_menages: forme.min_menages } };
}

/**
 * Les refus de `simplification_polygone_plateforme` : ceux de la couverture, et la règle polygone absente du registre
 * (`morceaux_tous_retires`, D37, est traité à part : son message porte les nombres).
 */
const MESSAGES_REFUS_POLYGONE = {
  ...MESSAGES_REFUS_COUVERTURE,
  regle_introuvable: 'Cette plateforme n’achète pas au polygone : réglez à nouveau le jeu avant d’extraire.',
} as const;

/** « 34 000 sommets pour 20 000 admis par la plateforme (à vérifier) » — les nombres viennent de la base et du registre. */
function texteDepassement(d: DepassementPolygone, premier: boolean): string {
  const unite = d.code === 'polygone_sommets_max' ? 'sommets' : 'morceaux';
  return `${formaterNombre(d.valeur)} ${unite} pour ${formaterNombre(d.limite)} admis${premier ? ' par la plateforme' : ''}`
    + `${d.a_verifier ? ' (à vérifier)' : ''}`;
}

/**
 * A7 (sql/312, D37 sql/340) : la forme mesurée par la base (`simplification_polygone_plateforme`) — toujours simplifiée
 * à 50 m, morceaux de moins de 0,04 km² retirés (réglages en base) — puis ses sommets et morceaux contrôlés contre les
 * bornes de la plateforme (registre relu ici). Tous les morceaux retirés : 422 `morceaux_tous_retires`, chiffré. Un dépassement REFUSE l'extraction (422
 * `polygone_trop_lourd`) avec les nombres obtenus et admis — la plateforme rejetterait le fichier. Un refus de la RPC
 * est préfixé de la plateforme, comme ceux de la couverture.
 */
async function mesurerPolygone(
  ctx: Contexte, plateforme: string, regle: PlateformeGeo,
): Promise<{ ok: true; mesure: MesureSimplification } | Echec> {
  const r = await ctx.supabase.rpc('simplification_polygone_plateforme', {
    p_zone_id: ctx.jeu.custom_geo_zone_id ?? '', p_org_id: ctx.jeu.org_id, p_cible: ctx.jeu.cible, p_plateforme: plateforme,
  });
  const m = rpcJson<MesureSimplification & { refus?: string }>(r.data);
  // D37 (sql/340) : tous les morceaux sous la surface minimale — la forme envoyée serait vide ; refus chiffré (avant → après).
  if (!r.error && m?.refus === 'morceaux_tous_retires') {
    const min = formaterNombre(Number(m.morceau_min_km2));
    return {
      ok: false,
      reponse: NextResponse.json({
        error: `${plateforme} — Les ${formaterNombre(m.morceaux_avant)} morceaux de la zone font tous moins de ${min} km² (un carreau) : `
          + `la forme envoyée au polygone en garderait 0. Agrandissez la zone, ou choisissez une autre maille.`,
        refus: 'morceaux_tous_retires', plateforme, morceaux_avant: m.morceaux_avant, morceaux: 0, morceau_min_km2: m.morceau_min_km2,
      }, { status: 422 }),
    };
  }
  if (r.error || !m || m.refus !== undefined || typeof m.sommets !== 'number' || typeof m.morceaux !== 'number') {
    return refusDe(plateforme, repondreCouverture(r, MESSAGES_REFUS_POLYGONE, 'zones/extractions polygone', ECHEC));
  }
  const depassements = depassementsPolygone(m, regle);
  if (depassements.length > 0) {
    // D37 : des morceaux retirés se disent aussi (ils ont déjà réduit le compte).
    const retires = (m.morceaux_retires ?? 0) > 0
      ? ` (${formaterNombre(m.morceaux_retires)} morceaux de moins de ${formaterNombre(m.morceau_min_km2)} km² retirés)` : '';
    const forme = m.tolerance_m > 0 ? `Même simplifié à ${formaterNombre(m.tolerance_m)} m${retires}, le polygone compte` : 'Le polygone compte';
    const message = `${plateforme} — ${forme} `
      + `${depassements.map((d, i) => texteDepassement(d, i === 0)).join(' et ')} : réduisez la zone, ou choisissez une autre maille.`;
    return {
      ok: false,
      reponse: NextResponse.json({
        error: message, refus: 'polygone_trop_lourd', plateforme, tolerance_m: m.tolerance_m,
        sommets_avant: m.sommets_avant, morceaux_avant: m.morceaux_avant, sommets: m.sommets, morceaux: m.morceaux,
        ...(m.morceaux_retires !== undefined ? { morceaux_retires: m.morceaux_retires } : {}),
        sommets_max: regle.polygone_sommets_max ?? null, morceaux_max: regle.polygone_morceaux_max ?? null, depassements,
      }, { status: 422 }),
    };
  }
  return { ok: true, mesure: m };
}

/** Une maille territoriale calculée : la couverture du découpage, puis le seuil. */
async function convertirTerritoire(ctx: Contexte, c: Choix, regle: PlateformeGeo): Promise<Issue> {
  const couverture = await lireCouverture(ctx, c.plateforme, c.maille);
  if (estEchec(couverture)) return couverture;
  const bilan = appliquerSeuil(couverture.lignes, couverture.population, c.seuil);
  if (bilan.n_unites === 0) return aucuneUnite(c);
  // C24 round 1 (I-1) : les minimums comparent la population TOTALE de chaque unité retenue.
  const populations = couverture.lignes.filter((l) => estRetenue(l, c.seuil)).map((l) => l.pop_totale_ind ?? l.pop_totale);
  // B14 (ARB-6) : au-delà de la limite d'unités, les retenues partent en blocs triés par part ; annoncé (`n` blocs).
  const d = decouperEnBlocs(couverture.lignes.filter((l) => estRetenue(l, c.seuil)), regle);
  const unites = couverture.lignes.map((l): Unite => ({
    plateforme: c.plateforme, maille: c.maille, code: l.code, nom: l.nom,
    pop_en_zone: l.pop_en_zone, pop_totale: l.pop_totale, part: l.part, retenu: estRetenue(l, c.seuil),
    ...(d?.blocs.has(l.code) ? { bloc: d.blocs.get(l.code) } : {}),
  }));
  return {
    ok: true, populations,
    // Dans l'ordre des blocs (`ordinal` : bloc puis part décroissante), les non retenues ensuite.
    unites: d ? dansLOrdreDesBlocs(unites, d.blocs) : unites,
    resume: {
      ...bilan, plateforme: c.plateforme, population: couverture.population,
      avertissements: [...verifierLimites(bilan, regle), ...avertissementsComposition(ctx.recette, regle.maille, couverture.lignes, c.seuil)],
      min_menages: couverture.min_menages, ...(d ? { decoupage: d.decoupage } : {}),
    },
  };
}

/** Le cercle calculé : `paver_cercles` aux limites de la plateforme ; seules les cellules retenues sont rendues. */
async function convertirCercles(ctx: Contexte, c: Choix, regle: PlateformeGeo): Promise<Issue> {
  // `rayon_m` est posé pour un cercle (CHECK `zsp_rayon_cercle`).
  const rayon_m = c.rayon_m ?? 0;
  const r = await paverPourPlateforme(ctx.supabase, {
    zoneId: ctx.jeu.custom_geo_zone_id ?? '', orgId: ctx.jeu.org_id, cible: ctx.jeu.cible, rayon_m, seuil: c.seuil,
  }, regle);
  const o = rpcJson<Pavage & { refus?: string }>(r.data);
  if (r.error || !o || o.refus !== undefined || !Array.isArray(o.cercles)) {
    return refusDe(c.plateforme, repondreCouverture(r, MESSAGES_CONVERSION, 'zones/extractions cercles', ECHEC, 'Rayon ou seuil hors des bornes du calcul.'));
  }
  // B13 : tout écarté par le minimum par cercle — dit tel quel (pas « au seuil »), avec le minimum et le plus peuplé.
  const ecartes = avertissementsEcartes(o.ecartes_pop_min, regle);
  if (o.n_cercles === 0 && ecartes.length > 0) return erreur(messageRefusPopulation({ ...ecartes[0], refus: true }, c.plateforme, c.maille), 422);
  if (o.n_cercles === 0) return aucuneUnite(c);
  const chiffres = {
    n_unites: o.n_cercles, couverte: o.couverte, achetee: o.achetee, manques: o.manques, hors_zone: o.hors_zone, taux_utile: o.taux_utile,
  };
  // `verifierLimites` lit un `Resume` ; `n_touchees` y vaut les cellules, et le résumé figé le nomme `n_candidates`.
  const bilan: Resume = { exacte: false, n_touchees: o.n_candidates, ...chiffres };
  return {
    ok: true,
    populations: o.cercles.map((k) => k.pop_totale_ind ?? k.pop_totale),  // C24 round 1 : la population totale du disque
    unites: o.cercles.map((k) => ({
      plateforme: c.plateforme, maille: 'cercle', lon: k.lon, lat: k.lat, rayon_m,
      pop_en_zone: k.pop_en_zone, pop_totale: k.pop_totale, part: k.part, retenu: true,
    })),
    resume: {
      ...chiffres, plateforme: c.plateforme, exacte: false, n_candidates: o.n_candidates, population: o.population, min_menages: o.min_menages,
      // A6 : la somme des lignes (disques) figée à côté du bilan (union dédoublonnée) — l'écart, ce sont les chevauchements.
      ...(o.somme_disques !== undefined ? { somme_disques: o.somme_disques } : {}),
      // A3 : un disque de rayon autour d'un point qui déborde du territoire se dit, figé avec le bilan.
      // B8 : le rayon de la recette hors des bornes de la plateforme (avant → après), figé avec le bilan.
      avertissements: [
        ...verifierLimites(bilan, regle), ...avertissementsDisque(ctx.recette, regle.maille), ...avertissementsRayon(ctx.recette, regle.maille, regle, rayon_m),
        ...ecartes,
      ],
    },
  };
}

/** Une plateforme : la règle relue (la table a pu changer depuis l'enregistrement), l'exactitude, puis sa maille. */
/**
 * B13 : les minimums de population de la plateforme, le MÊME contrôle pour toute maille — cercle exact unique compris
 * (son unité porte la population de la zone, le disque entier) : sur les unités RETENUES et la diffusion achetée. Un
 * refus du registre refuse l'extraction (422 `pop_min_unite` / `pop_min_groupe`, chiffré) ; un avertissement est figé.
 */
async function controler(issue: Promise<Issue>, c: Choix, regle: PlateformeGeo): Promise<Issue> {
  const r = await issue;
  if (!r.ok) return r;
  const controle = controlerPopulation(r.resume, r.populations ?? r.unites.filter((u) => u.retenu).map((u) => u.pop_totale), regle);
  if (controle.refus) {
    const { code, limite, valeur, n, bloc } = controle.refus;
    return {
      ok: false,
      reponse: NextResponse.json({
        error: messageRefusPopulation(controle.refus, c.plateforme, c.maille), refus: code, plateforme: c.plateforme, limite, valeur,
        ...(n !== undefined ? { n } : {}), ...(bloc !== undefined ? { bloc } : {}),
      }, { status: 422 }),
    };
  }
  r.resume.avertissements.push(...controle.avertissements);
  return r;
}

function convertir(ctx: Contexte, c: Choix, regles: readonly PlateformeGeo[]): Promise<Issue> | Issue {
  const regle = regles.find((l) => l.plateforme === c.plateforme && l.maille === c.maille);
  const refus = refusDuChoix(c, regle);
  if (refus || !regle) return erreur(`${refus} Réglez à nouveau le jeu avant d’extraire.`, 422);
  // Un choix enregistré avant la règle « maille sans objet » (⑤ finitions, A-3) : refusé avant toute lecture.
  const sansObjet = mailleSansObjet(ctx.recette, regle.maille, ctx.nationaleMoins);
  if (sansObjet) {
    return {
      ok: false,
      reponse: NextResponse.json({
        error: `${c.plateforme} — ${sansObjet} Réglez à nouveau le jeu avant d’extraire.`, refus: 'maille_sans_objet', plateforme: c.plateforme,
      }, { status: 422 }),
    };
  }
  // Sans recette lisible (zone d'avant le lot 3), seule la forme exacte est exacte.
  const exacte = ctx.recette
    ? exactitude(ctx.recette, regle.maille, regle, c.rayon_m ?? undefined) === 'exacte'
    : regle.maille === 'polygone';
  if (exacte) return controler(convertirExacte(ctx, c, regle), c, regle);
  return controler(c.maille === 'cercle' ? convertirCercles(ctx, c, regle) : convertirTerritoire(ctx, c, regle), c, regle);
}

/**
 * Les messages des codes métier de `creer_extraction_jeu_zone` : un code brut ne dit rien à qui lit l'écran. Les deux
 * premiers sont ceux du chargeur (`charger-jeu.ts`) : la même situation se dit par la même phrase.
 */
const MESSAGES_RPC: Record<string, string> = {
  jeu_introuvable: MESSAGE_JEU_INTROUVABLE,
  type_non_zone: OU_SE_GERE.risque,
  plan_vide: 'Ce jeu ne produit aucun plan : il n’y a rien à extraire.',
  unites_hors_choix: 'Le choix des plateformes a changé pendant l’extraction : relancez-la.',
};

/** Les plans CP d'une extraction : le plan commun (⑥/⑦) et celui de chaque plateforme au CP (B12). */
interface PlansCp {
  /**
   * Le plan COMMUN (seuil le plus bas des plateformes au CP), écrit dans `zone_set_extraction_cp`.
   *
   * @deprecated D32 (sql/334) : la source de vérité est `parPlateforme` (`zone_set_extraction_cp_plateforme`, B12).
   * Gardé tant que ⑥/⑦ le lisent ; retiré dans le commit qui leur fait lire le plan par plateforme (côté dentsu).
   * Les extractions déjà produites gardent leur plan commun figé, en lecture seule.
   */
  commun: ReturnType<typeof planCpDeZone>;
  parPlateforme: PlanPlateforme[];
}

/**
 * Les plans CP, si une plateforme achète au CP : groupes indiscernables, couverture CP, liste exacte éventuelle, et le
 * registre des mécanismes de poids — le plan commun au réglage `reglageDuPlan` de toutes (plage la plus étroite, règle
 * de groupe unique, A1), celui de chaque plateforme au réglage de ses seuls mécanismes (B12).
 */
async function planCp(
  ctx: Contexte, auCp: readonly Choix[], reglage: ReglagePlan, poids: readonly PlateformePoids[],
): Promise<PlansCp | null | Echec> {
  if (auCp.length === 0) return null;
  let groupes: MembresParCanonique;
  try {
    groupes = await lireGroupesCp(ctx.supabase);
  } catch (e) {
    return panne('groupes de CP', e);
  }
  // Déjà lue par la boucle pour un CP calculé ; pour un CP exact, lue ici (le plan a besoin des populations).
  const cp = await lireCouverture(ctx, auCp[0].plateforme, 'cp');
  if (estEchec(cp)) return cp;
  const r = ctx.recette;
  const liste = r && exactitude(r, 'cp') === 'exacte' ? unitesConstitutives(r)?.codes : undefined;
  // A8 : les volumes attendus (population totale, Q9 = A) des unités et du référentiel, pour la part prévue E5 ; D35 :
  // le référentiel restreint à l'univers de la zone (métropole, ou France entière dès qu'elle touche un DROM).
  const codes = [...cp.lignes.map((l) => l.code), ...(liste ?? [])];
  let volumes: VolumesAttendus;
  try {
    volumes = await lireVolumesAttendus(ctx.supabase, codes, universDeZone(codes, r));
  } catch (e) {
    return panne('volumes attendus', e);
  }
  const mode = ctx.jeu.mode_plan as ModePlan;
  const propres = plansParPlateforme(cp.lignes, auCp, mode, groupes, poids, liste, volumes);
  if (!propres.ok) return erreur(`${propres.message} Réglez à nouveau le jeu avant d’extraire.`, 422);
  const commun = planCpDeZone(cp.lignes, Math.min(...auCp.map((c) => c.seuil)), mode, groupes, liste, reglage, volumes);
  return { commun, parPlateforme: propres.plans };
}

/**
 * POST d'une extraction de jeu de zone, APRÈS session, corps, quota et chargement du jeu (la route les fait).
 * 201 la version créée, 200 `deja_extraite` (même contenu qu'une version existante), 409 / 422 / 500 sinon.
 */
export async function extraireJeuZone(
  supabase: ClientAdmin, jeu: LigneJeu, corps: { origine: string; commentaire: string }, userId: string,
): Promise<NextResponse> {
  // Deux lectures légères en parallèle (≤ 3, CLAUDE.md) : les choix, la recette de la zone.
  const [choixLus, zoneLue] = await Promise.all([
    supabase.from('zone_set_plateformes').select('plateforme, maille, seuil, rayon_m').eq('zone_set_id', jeu.id).order('plateforme'),
    supabase.from('custom_geo_zones').select('recette, unites_constitutives').eq('id', jeu.custom_geo_zone_id ?? '').eq('org_id', jeu.org_id).maybeSingle(),
  ]);
  if (choixLus.error) return panne('choix', choixLus.error.message).reponse;
  // La zone ne peut manquer (clé étrangère `on delete restrict`) : son absence est une anomalie.
  if (zoneLue.error || !zoneLue.data) return panne('zone du jeu', zoneLue.error?.message ?? 'absente').reponse;
  const lue = lireRecette(recetteVue(zoneLue.data.recette, zoneLue.data.unites_constitutives)); // B15 : la colonne (sql/321).
  // Décision du 02/11 (+ tour 3 : sources d'une combinaison) : un rayon sous le minimum d'activation ne s'active jamais —
  // refusé avant les règles et toute RPC, sans relèvement.
  const tropFin = await refusActivationServeur(supabase, jeu.org_id, zoneLue.data.recette).catch((e: unknown) => panne('sources de la zone', e));
  if (typeof tropFin === 'object' && tropFin) return tropFin.reponse;
  if (tropFin) return NextResponse.json({ error: tropFin, refus: 'rayon_non_activable' }, { status: 422 });
  const choix: Choix[] = (choixLus.data ?? []).map((c) => ({ ...c, seuil: Number(c.seuil) }));
  if (choix.length === 0) return erreur('Ce jeu n’a aucune plateforme : il n’y a rien à extraire.', 409).reponse;

  let regles: PlateformeGeo[];
  try {
    // C29 : un jeu coché « catégorie spéciale » lit le rayon minimal spécial de la plateforme (`regleCategorieSpeciale`).
    regles = (await lireRegles(supabase, choix.map((c) => c.plateforme))).map((l) => regleCategorieSpeciale(l, jeu.categorie_speciale === true));
  } catch (e) {
    return panne('règles', e).reponse;
  }
  // Revue T6 (I-2) : une lecture (`zone_pays_moins_base`), pour une différence seulement ; en échec, VRAI (refus prudent).
  const nationaleMoins = await estNationaleMoins(supabase, jeu.custom_geo_zone_id ?? '', jeu.org_id, zoneLue.data.recette);
  const ctx: Contexte = { supabase, jeu, recette: lue.ok ? lue.recette : null, nationaleMoins, couvertures: new Map() };

  const unites: Unite[] = [];
  const resumes: ResumePlateforme[] = [];
  for (const c of choix) {
    // SÉQUENTIEL, à dessein (en-tête) : une conversion à la fois.
    const issue = await convertir(ctx, c, regles);
    if (!issue.ok) return issue.reponse;
    unites.push(...issue.unites);
    resumes.push(issue.resume);
  }

  // A1 : les mécanismes de poids des plateformes au CP (`plateformes_poids`), lus une fois ; une règle de groupe
  // divergente ou une plateforme sans mécanisme refuse l'extraction en le disant (règle 5).
  const auCp = choix.filter((c) => c.maille === 'cp');
  let poids: PlateformePoids[] = [];
  let reglage: ReglagePlan = {};
  if (auCp.length > 0) {
    try {
      poids = await lirePoids(supabase, auCp.map((c) => c.plateforme), 'cp');
    } catch (e) {
      return panne('mécanismes de poids', e).reponse;
    }
    const r = reglageDuPlan(poids, auCp.map((c) => c.plateforme));
    if (!r.ok) return erreur(`${r.message} Réglez à nouveau le jeu avant d’extraire.`, 422).reponse;
    reglage = r.reglage;
  }

  const plans = await planCp(ctx, auCp, reglage, poids);
  if (plans && 'ok' in plans) return plans.reponse;
  const plan = plans?.commun ?? null;
  // A1, règle 5 : ce que le mécanisme de poids fait au plan est DIT sur chaque plateforme au CP — écrêtages (avant /
  // après, comptés en unités CP, chez les seules plateformes dont un mécanisme multiplicateur porte la borne), envois
  // découpés au-delà de `nb_max_entrees` (comptés en codes). B12 tour 1 (I-1) : d'après le plan COMMUN, celui que ⑥/⑦
  // poussent encore — dire ceux du plan propre seulement tairait un écrêtage réel ; ceux du plan propre vont dans
  // `plan_cp`, figés avec son bilan.
  for (const propre of plans?.parPlateforme ?? []) {
    const r = resumes.find((x) => x.plateforme === propre.plateforme);
    if (!r || !plan) continue;
    const s = sortiesPoids(poids, r.plateforme, r.n_codes ?? r.n_unites, plan.resume.multiplicateur);
    r.poids = s.sorties;
    r.avertissements.push(...s.avertissements);
    const sp = sortiesPoids(poids, r.plateforme, propre.plan.resume.n_codes, propre.plan.resume.multiplicateur);
    r.plan_cp = { seuil: propre.seuil, ...propre.plan.resume, poids: sp.sorties, avertissements: sp.avertissements };
  }
  // B12 : les lignes de chaque plan (unités RETENUES, développées en codes) → `zone_set_extraction_cp_plateforme`.
  const plansPlateformes = (plans?.parPlateforme ?? []).map((p) => ({
    plateforme: p.plateforme, seuil: p.seuil, lignes: p.plan.lignes.filter((l) => l.retenu),
  }));

  const { data: brut, error } = await supabase.rpc('creer_extraction_jeu_zone', {
    p_zone_set_id: jeu.id,
    p_cp: toJson(plan?.lignes ?? []),
    p_unites: toJson(unites),
    p_resume: toJson({ ...(plan?.resume ?? {}), plateformes: resumes, plans_plateformes: plansPlateformes }),
    p_origine: corps.origine,
    p_commentaire: corps.commentaire,
    p_created_by: userId,
  });
  if (error) return panne('création', error.message).reponse;
  const data = rpcJson<{ ok: boolean; error?: string; deja_extraite?: boolean }>(brut);
  if (!data?.ok) return erreur(MESSAGES_RPC[data?.error ?? ''] ?? ECHEC, 409).reponse;
  return NextResponse.json(data, { status: data.deja_extraite ? 200 : 201 });
}
