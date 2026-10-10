/**
 * Codes (CP, IRIS, département, région) d'une zone custom, lus EN ENTIER.
 *
 * `custom_geo_zone_codes` est une table : PostgREST la coupe à `db-max-rows`
 * = 1 000 lignes (`supabase/config.toml`), et aucun `.limit()` client ne lève
 * ce plafond. Les quatre lecteurs de cette table — export CSV, export DV360,
 * push du ciblage, push de la location list — écrivaient `.limit(100000)` en
 * se croyant protégés par un plafond de 5 000 (réglage de l'ancien projet
 * hébergé). Mesuré le 2026-10-10 : une zone porte 1 641 codes postaux, une
 * autre 9 834 IRIS ; tous les quatre en lisaient 1 000, et le ciblage poussé
 * chez DV360 couvrait donc une partie de la zone, sans erreur.
 *
 * Lecture paginée par `lireTout` : tout, ou une erreur.
 */
import type { createAdminClient } from '@/lib/auth';
import { lireTout } from '@/lib/supabase/lire-tout';

/**
 * Borne de la lecture : au-delà, elle échoue au lieu de tronquer. Au-dessus du
 * plus grand cas possible (une zone France entière : 6 187 CP, ~50 000 IRIS).
 */
const PLAFOND_CODES_ZONE = 60_000;

type TypeCodeZone = 'cp' | 'iris' | 'dept' | 'region';

/**
 * Lit tous les codes d'un type pour une zone, triés.
 *
 * @throws {Error} Si une page échoue ou si la zone dépasse `PLAFOND_CODES_ZONE`.
 */
export async function lireCodesDeZone(
  supabase: ReturnType<typeof createAdminClient>,
  zoneId: string,
  codeType: TypeCodeZone,
): Promise<string[]> {
  // `order('code')` sur la clé primaire (zone_id, code_type, code) : ordre
  // total, donc deux pages ne se recouvrent jamais.
  const { lignes } = await lireTout<{ code: string }>(
    (de, a) => supabase
      .from('custom_geo_zone_codes')
      .select('code')
      .eq('zone_id', zoneId)
      .eq('code_type', codeType)
      .order('code')
      .range(de, a),
    PLAFOND_CODES_ZONE,
  );
  return lignes.map((l) => l.code);
}
