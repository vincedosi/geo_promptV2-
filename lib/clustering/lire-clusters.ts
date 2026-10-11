/**
 * Lectures de `poi_clusters` et des POI qu'elles désignent, sans le plafond
 * silencieux de PostgREST.
 *
 * PostgREST coupe toute requête de table à `db-max-rows` = 1 000
 * (`CLAUDE.md` § « Troncature PostgREST »). `GET /api/poi-clusters`,
 * `/api/poi-clusters/models/[version]` et `/api/poi-clusters/[clusterId]`
 * lisaient `poi_clusters` d'une traite, puis `poi_france` par un seul
 * `.in('id', ids)` : 95 lignes aujourd'hui, mais un modèle national
 * (5 584 lycées, 99 152 sites à risque) aurait été coupé à 1 000 POI sans
 * erreur — et la liste d'ids, elle, aurait fait déborder l'URL.
 *
 * - `poi_clusters` se lit par `lireTout`, triée sur sa clé primaire `id`
 *   (une pagination par décalage exige un ordre stable).
 * - `poi_france` se lit par lots de `LOT_IDS` ids, l'un après l'autre (jamais
 *   en parallèle : § Disk I/O). Chaque lot est sous 1 000, donc jamais coupé.
 */
import { lireTout } from '@/lib/supabase/lire-tout';
import type { createAdminClient } from '@/lib/auth';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/**
 * Nombre maximal de lignes `poi_clusters` lues pour UNE réponse. Au-delà, la
 * lecture échoue (500 explicite) au lieu de rendre un début : le plus gros
 * modèle réaliste, les lycées de France, en compte 5 584 ; 20 000 laisse de la
 * marge sans laisser une route rendre 100 000 POI d'un coup.
 */
const PLAFOND_POI_CLUSTERS = 20_000;

/**
 * Taille d'un lot d'ids pour `poi_france.in('id', …)`. Borne MESURÉE, pas
 * supposée : le 2026-10-11, sur le stack local, `select('id,nom').in('id', …)`
 * passait à 200 UUID et rendait « URI too long » dès 250 (Kong). Les lots de
 * 500 qu'employait `/api/poi-clusters/poi-types` jusqu'à cette date auraient
 * donc échoué au premier modèle de plus de 250 POI. 150 garde de la marge
 * pour des listes `select` plus longues ; et sous 1 000, jamais tronqué.
 */
const LOT_IDS = 150;

/** Filtres d'égalité appliqués à la lecture de `poi_clusters`. */
type FiltresPoiClusters = Record<string, string | number>;

/**
 * Lit TOUTES les lignes de `poi_clusters` qui répondent aux filtres, ou lève.
 *
 * @param sb - Client admin.
 * @param colonnes - La liste `select`. Le tri porte sur `id`, qu'elle n'a pas besoin de contenir.
 * @param filtres - Égalités colonne → valeur.
 * @throws {Error} Si une page échoue ou si `PLAFOND_POI_CLUSTERS` est franchi.
 */
export async function lirePoiClusters<T>(
  sb: ClientAdmin,
  colonnes: string,
  filtres: FiltresPoiClusters,
): Promise<T[]> {
  const { lignes } = await lireTout<T>(
    (de, a) => {
      let q = sb.from('poi_clusters').select(colonnes);
      for (const [col, val] of Object.entries(filtres)) q = q.eq(col, val);
      return q.order('id', { ascending: true }).range(de, a) as unknown as PromiseLike<{
        data: T[] | null; error: { message: string } | null;
      }>;
    },
    PLAFOND_POI_CLUSTERS,
  );
  return lignes;
}

/**
 * Lit les lignes `poi_france` des ids donnés, par lots séquentiels.
 *
 * @param sb - Client admin.
 * @param colonnes - La liste `select` ; doit contenir `id`.
 * @param ids - Ids des POI (doublons tolérés).
 * @throws {Error} Si un lot échoue.
 */
export async function lirePoiParIds<T>(
  sb: ClientAdmin,
  colonnes: string,
  ids: string[],
): Promise<T[]> {
  const uniques = [...new Set(ids)];
  const lignes: T[] = [];
  for (let i = 0; i < uniques.length; i += LOT_IDS) {
    const { data, error } = await (sb
      .from('poi_france')
      .select(colonnes)
      .in('id', uniques.slice(i, i + LOT_IDS)) as unknown as PromiseLike<{
        data: T[] | null; error: { message: string } | null;
      }>);
    if (error) throw new Error(`Lecture des POI interrompue au lot ${i / LOT_IDS + 1} : ${error.message}`);
    lignes.push(...(data ?? []));
  }
  return lignes;
}
