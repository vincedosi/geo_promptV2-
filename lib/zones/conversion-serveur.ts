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
import { MAX_PLATEFORMES_GEO, PlateformeGeoSchema, type PlateformeGeo } from './plateformes';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/** Les colonnes d'une ligne de `plateformes_geo` — une chaîne LITTÉRALE : supabase-js en déduit le type des lignes. */
const COLONNES_PLATEFORMES_GEO =
  'plateforme, maille, libelle, natif, disponible, limites, doc_url, releve_le, a_verifier, note, ordre, codes_pays, pays_a_verifier';

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
 * DV360) et `max_unites` (plafond de cercles, Meta : refus `trop_de_cercles` chiffré). Rend la réponse brute de
 * supabase-js ; `repondreCouverture` la traduit.
 */
export function paverPourPlateforme(supabase: ClientAdmin, d: DemandePavage, regle: PlateformeGeo) {
  return supabase.rpc('paver_cercles', {
    p_zone_id: d.zoneId,
    p_org_id: d.orgId,
    p_cible: d.cible,
    p_rayon_m: d.rayon_m,
    p_seuil: d.seuil,
    // `undefined` : la clé n'est pas envoyée, la RPC garde son défaut — aucune limite écrite ici.
    p_pop_min: regle.limites.pop_min_unite,
    p_max_cercles: regle.limites.max_unites,
  });
}
