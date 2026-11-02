/**
 * @file lib/zones/conversion-serveur.ts — ce que les routes de ⑤ partagent pour convertir une zone côté SERVEUR
 * (lot 5, T8) : la règle d'une plateforme lue dans `plateformes_geo`, le refus d'un choix qu'elle n'admet pas, et
 * l'appel de `paver_cercles` avec les limites de la plateforme. Lu par `GET /api/zones/[id]/cercles`, par
 * l'extraction d'un jeu de zone (`extraction-jeu-zone.ts`) et par l'enregistrement d'un jeu (`jeu-zone-routes.ts`).
 *
 * À part de `conversion.ts`, qui est PUR et recopié côté Angular : ici on lit la base et on parle HTTP.
 *
 * Aucune limite n'est écrite ici (§ 16.2-3) : nombre de cercles, bornes du rayon, population minimale d'un cercle
 * viennent de la ligne lue. Une limite absente n'est pas passée à la RPC, qui garde alors son défaut (aucun plafond,
 * population minimale nulle) et ses seules bornes de SÉCURITÉ (rayon dans [1 000, 200 000] m, sql/276).
 */
import { z } from 'zod';
import type { createAdminClient } from '@/lib/auth';
import { formaterNombre } from '@/lib/format/nombre';
import {
  MAX_PLATEFORMES_GEO, MAX_PLATEFORMES_POIDS, PlateformeGeoSchema, PlateformePoidsSchema, type PlateformeGeo, type PlateformePoids,
} from './plateformes';
import { REGLAGES_DEFAUT_REPLI, type ReglagesDefaut } from './conversion-defaut';
import type { Avertissement } from './conversion';
import { popMinPavage } from './conversion-population';
import { type GardeRecherche, chercherRayonPropose } from './rayon-propose';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/** Les colonnes d'une ligne de `plateformes_geo` — une chaîne LITTÉRALE : supabase-js en déduit le type des lignes. */
const COLONNES_PLATEFORMES_GEO =
  'plateforme, maille, libelle, natif, disponible, limites, doc_url, releve_le, a_verifier, note, ordre, codes_pays, pays_a_verifier, poids_groupe_cp, parametres_a_verifier, polygone_sommets_max, polygone_morceaux_max, pop_min_unite_comportement, pop_min_groupe_comportement';

/**
 * Les règles des plateformes demandées (toutes sans filtre : `GET /api/zones/plateformes`), triées par `ordre` et
 * validées par le schéma — la SEULE lecture de `plateformes_geo` du serveur (revue finale du lot 5, point 10 : il y en
 * avait trois, avec trois bornes). Bornée par construction (≤ 4 plateformes × 6 mailles, clé primaire) et par
 * `MAX_PLATEFORMES_GEO + 1` lue (au-delà : une erreur dite, jamais une liste coupée). Lève sur une erreur de lecture ou
 * une ligne hors schéma : l'appelant répond 500 et journalise.
 */
export async function lireRegles(supabase: ClientAdmin, plateformes?: readonly string[]): Promise<PlateformeGeo[]> {
  const requete = supabase.from('plateformes_geo').select(COLONNES_PLATEFORMES_GEO);
  const { data, error } = await (plateformes ? requete.in('plateforme', [...new Set(plateformes)]) : requete)
    .order('ordre', { ascending: true })
    .limit(MAX_PLATEFORMES_GEO + 1);
  if (error) throw new Error(`lecture de plateformes_geo : ${error.message}`);
  if ((data ?? []).length > MAX_PLATEFORMES_GEO) throw new Error('plateformes_geo : borne de lecture dépassée');
  return z.array(PlateformeGeoSchema).parse(data ?? []);
}

/** Les colonnes d'une ligne de `plateformes_poids` (sql/305, A1) — chaîne littérale, comme ci-dessus. */
const COLONNES_PLATEFORMES_POIDS =
  'plateforme, maille, mecanisme, valeur_min, valeur_max, pas, nb_max_entrees, nb_paliers_max, poids_groupe_cp, branche, parametres_a_verifier, note, releve_le';

/**
 * Les mécanismes de poids des plateformes demandées à une maille (`plateformes_poids`, sql/305, A1, amendement E2),
 * validés par le schéma. Bornée par construction (clé primaire) et par `MAX_PLATEFORMES_POIDS + 1` lue. Lève sur une
 * erreur de lecture ou une ligne hors schéma, comme `lireRegles`.
 */
export async function lirePoids(
  supabase: ClientAdmin, plateformes: readonly string[], maille: string,
): Promise<PlateformePoids[]> {
  const { data, error } = await supabase.from('plateformes_poids').select(COLONNES_PLATEFORMES_POIDS)
    .in('plateforme', [...new Set(plateformes)])
    .eq('maille', maille)
    .order('plateforme', { ascending: true })
    .order('mecanisme', { ascending: true })
    .limit(MAX_PLATEFORMES_POIDS + 1);
  if (error) throw new Error(`lecture de plateformes_poids : ${error.message}`);
  if ((data ?? []).length > MAX_PLATEFORMES_POIDS) throw new Error('plateformes_poids : borne de lecture dépassée');
  return z.array(PlateformePoidsSchema).parse(data ?? []);
}

/** B9 : la clé de `reglages_conversion` (sql/315) de chaque réglage de la maille par défaut. */
const CLES_REGLAGES_DEFAUT: Readonly<Record<keyof ReglagesDefaut, string>> = {
  couverture_cible: 'couverture_cible_defaut',
  ecart_departage: 'ecart_departage_defaut',
};

/**
 * B9 (ARB-7) : la couverture cible et l'écart de départage de la maille par défaut, lus dans `reglages_conversion`
 * (sql/315) — UNE lecture de deux lignes (clé primaire). Ne lève pas : une lecture en échec ou une clé absente (ou
 * illisible) prend la valeur de `REGLAGES_DEFAUT_REPLI`, les mêmes que la migration, et le dit au journal — le
 * registre des plateformes reste servi, le défaut reste calculable.
 */
export async function lireReglagesDefaut(supabase: ClientAdmin): Promise<ReglagesDefaut> {
  const reglages: ReglagesDefaut = { ...REGLAGES_DEFAUT_REPLI };
  const { data, error } = await supabase.from('reglages_conversion').select('cle, valeur').in('cle', Object.values(CLES_REGLAGES_DEFAUT));
  if (error) {
    console.error('[reglages_conversion] lecture impossible, repli REGLAGES_DEFAUT_REPLI :', error.message);
    return reglages;
  }
  const manquantes: string[] = [];
  for (const [champ, cle] of Object.entries(CLES_REGLAGES_DEFAUT) as [keyof ReglagesDefaut, string][]) {
    const valeur = Number((data ?? []).find((l) => l.cle === cle)?.valeur);
    if (Number.isFinite(valeur)) reglages[champ] = valeur;
    else manquantes.push(cle);
  }
  if (manquantes.length > 0) console.error(`[reglages_conversion] ${manquantes.join(', ')} absente(s), repli REGLAGES_DEFAUT_REPLI`);
  return reglages;
}

/** Ce qu'un choix de plateforme demande : la maille et, pour un cercle, le rayon. */
interface ChoixDemande { plateforme: string; maille: string; rayon_m?: number | null }

/** Ce que la règle d'une plateforme dit d'un choix : achetable, et dans quelles bornes. */
interface RegleChoix { disponible: boolean; note: string | null; limites: unknown }

/**
 * Pourquoi la plateforme n'admet pas ce choix — couple absent de `plateformes_geo`, maille `disponible = false` (avec
 * la note de la table), rayon hors des bornes de la plateforme — ou `null` s'il est admis. Message français, prêt pour
 * un 400 (saisie) ou un 422 (extraction d'un choix que la table n'admet plus).
 */
export function refusDuChoix(choix: ChoixDemande, regle: RegleChoix | undefined): string | null {
  if (!regle) return `${choix.plateforme} n’achète pas à la maille ${choix.maille}.`;
  if (!regle.disponible) {
    return `La maille ${choix.maille} n’est pas disponible chez ${choix.plateforme}${regle.note ? ` : ${regle.note}` : '.'}`;
  }
  if (choix.rayon_m === undefined || choix.rayon_m === null) return null;
  const { rayon_min_m: min, rayon_max_m: max } = (regle.limites ?? {}) as { rayon_min_m?: number; rayon_max_m?: number };
  if ((min === undefined || choix.rayon_m >= min) && (max === undefined || choix.rayon_m <= max)) return null;
  // Ici une borne au moins est posée (sinon le rayon serait admis).
  const bornes = min === undefined ? `au plus ${formaterNombre(max as number)} m`
    : max === undefined ? `au moins ${formaterNombre(min)} m`
    : `${formaterNombre(min)} à ${formaterNombre(max)} m`;
  return `Rayon de ${formaterNombre(choix.rayon_m)} m hors des bornes de ${choix.plateforme} (${bornes}).`;
}

/** Ce que `paver_cercles` reçoit : la zone de l'ESPACE de la session, la cible, le rayon, le seuil. */
interface DemandePavage { zoneId: string; orgId: string; cible: string; rayon_m: number; seuil: number }

/**
 * `paver_cercles` (sql/276) avec les limites de la plateforme : `pop_min_unite` (population minimale d'un cercle,
 * DV360) quand le registre dit `refus` (`popMinPavage`, B13 — en `avertissement`, rien n'est filtré) et `max_unites`
 * (plafond de cercles, Meta : refus `trop_de_cercles` chiffré). Rend la réponse brute de supabase-js ;
 * `repondreCouverture` la traduit.
 */
export function paverPourPlateforme(supabase: ClientAdmin, d: DemandePavage, regle: PlateformeGeo) {
  return supabase.rpc('paver_cercles', {
    p_zone_id: d.zoneId,
    p_org_id: d.orgId,
    p_cible: d.cible,
    p_rayon_m: d.rayon_m,
    p_seuil: d.seuil,
    // `undefined` : la clé n'est pas envoyée, la RPC garde son défaut — aucune limite écrite ici.
    p_pop_min: popMinPavage(regle),
    p_max_cercles: regle.limites.max_unites,
  });
}

/**
 * Tour 1 de B10 (I-1) : le temps qu'une requête de `GET /api/zones/[id]/cercles` peut donner à la recherche du rayon
 * proposé, compté depuis l'ARRIVÉE de la requête (pavage refusé compris). 40 s sous le `maxDuration` de 60 s : 20 s
 * de marge pour la réponse et pour un essai plus cher que le précédent — la garde n'arrête que si le temps restant ne
 * couvre pas le dernier essai, et le coût d'un pavage MONTE avec le rayon (mesuré : 0,16 s à 1 km sur 20 km², 4,2 s à
 * 32,5 km sur 30 000 km², 5,6 s au pire connu, ARA à 40 km depuis A6). Un essai ne peut donc commencer après 40 s.
 */
export const BUDGET_RECHERCHE_RAYON_MS = 40_000;

/**
 * B10 : le pavage de `paverPourPlateforme`, et, s'il est refusé `trop_de_cercles`, le plus petit rayon qui passe sous
 * le plafond (`chercherRayonPropose`, au plus `ESSAIS_RAYON_PROPOSE` pavages de plus, UN À LA FOIS) ajouté au refus :
 * `rayon_propose` (`{ rayon_m, n_cercles, au_pas, essais }`) ou `null` avec `sans_proposition` (le motif), et
 * `interrompue` (`{ cause, dernier_rayon_m, dernier_n_cercles }`) si la garde a arrêté la recherche. Rien n'est
 * appliqué : l'écran montre le refus (avant) et la proposition (après), l'utilisateur choisit. Tout autre résultat est
 * rendu tel quel. Un essai en échec est journalisé et arrête la recherche ; le refus d'origine reste rendu.
 *
 * `garde` (tour 1, I-1) : `consommer` prend un jeton du quota de la route avant CHAQUE essai, `reste_ms` le temps qui
 * reste au budget `BUDGET_RECHERCHE_RAYON_MS` — la route les fournit.
 */
export async function paverAvecProposition(supabase: ClientAdmin, d: DemandePavage, regle: PlateformeGeo, garde?: GardeRecherche) {
  const avant = garde?.reste_ms();
  const pavage = await paverPourPlateforme(supabase, d, regle);
  const o = pavage.data as { refus?: unknown; n_cercles?: unknown; plafond?: unknown } | null;
  if (pavage.error || o?.refus !== 'trop_de_cercles' || typeof o.n_cercles !== 'number' || typeof o.plafond !== 'number') return pavage;
  const duree_ms = garde && avant !== undefined ? Math.max(0, avant - garde.reste_ms()) : 0;
  const proposition = await chercherRayonPropose(async (rayon_m) => {
    const essai = await paverPourPlateforme(supabase, { ...d, rayon_m }, regle);
    if (essai.error) {
      console.error('[zones/cercles] rayon proposé, essai à', rayon_m, 'm :', essai.error.code, essai.error.message);
      return null;
    }
    const e = essai.data as { refus?: unknown; n_cercles?: unknown } | null;
    return { n_cercles: typeof e?.n_cercles === 'number' ? e.n_cercles : 0, ...(typeof e?.refus === 'string' ? { refus: e.refus } : {}) };
  }, { rayon_m: d.rayon_m, n_cercles: o.n_cercles, plafond: o.plafond, duree_ms }, regle.limites, garde);
  return { ...pavage, data: { ...o, ...proposition } as unknown as typeof pavage.data };
}

/**
 * B13 : le refus d'un minimum de population (`controlerPopulation`), en français, préfixé de la plateforme — un 422
 * de l'extraction. Les nombres viennent du bilan et du registre ; « à vérifier » à côté de la valeur (E9).
 * Cercle exact unique : « dv360 — Le cercle compte 300 habitants, sous le minimum de 1 000 (à vérifier) par cercle de
 * la plateforme : élargissez le rayon, ou choisissez une autre maille. » (« à vérifier » à côté de la valeur, comme l'écran).
 */
export function messageRefusPopulation(a: Avertissement, plateforme: string, maille: string): string {
  const verifier = a.a_verifier ? ' (à vérifier)' : '';
  if (a.code === 'pop_min_groupe') {
    return `${plateforme} — La diffusion achetée compte ${formaterNombre(a.valeur)} personnes, sous le minimum de `
      + `${formaterNombre(a.limite)}${verifier} par groupe de la plateforme : élargissez la zone, ou choisissez une autre maille.`;
  }
  const cercle = maille === 'cercle';
  const n = a.n ?? 1;
  const qui = n === 1
    ? `${cercle ? 'Le cercle compte' : 'Une unité compte'} ${formaterNombre(a.valeur)} habitants`
    : `${formaterNombre(n)} ${cercle ? 'cercles' : 'unités'} comptent moins de ${formaterNombre(a.limite)} habitants (${a.ecartes ? 'le plus peuplé' : 'le moins peuplé'} : ${formaterNombre(a.valeur)})`;
  return `${plateforme} — ${qui}, sous le minimum de ${formaterNombre(a.limite)}${verifier} par ${cercle ? 'cercle' : 'unité'} de la plateforme : `
    + `${cercle ? 'élargissez le rayon' : 'relevez le seuil'}, ou choisissez une autre maille.`;
}
