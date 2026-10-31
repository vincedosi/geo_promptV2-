/**
 * @file lib/zones/part-prevue-serveur.ts — les deux lectures de la part prévue (A8, amendement E5 ; sql/306).
 *
 * - `lireVolumesAttendus` : le volume attendu V1 (population totale, Q9 = A) des unités CP demandées et du référentiel
 *   entier, d'où l'extraction tire le volume de `HORS_ZONE` (`volumes_attendus_cp`, un passage sur 6 009 lignes) ;
 * - `lireHorsZone` : LE lecteur partagé de la ligne `HORS_ZONE` figée d'une extraction (E3, E8) — l'extraction, le
 *   rattachement et le noyau d'optimisation (`docs/rebid-v2.md` § 5, `cps` reçoit cette ligne) la lisent par lui et par
 *   lui seul. Son corps est la fonction SQL `hors_zone_extraction` : un consommateur SQL (rollups du noyau) appelle la
 *   même, jamais `resume_plan` en direct.
 */
import { z } from 'zod';
import type { ClientAdmin } from './plan-extraction';
import type { VolumesAttendus } from './plan-jeu-zone';
import { CODE_HORS_ZONE } from './plan';

const VolumesSchema = z.object({
  total: z.coerce.number().nonnegative(),
  codes: z.record(z.string(), z.coerce.number()),
});

/**
 * Les volumes attendus des unités `codes` et le total du référentiel. Lève sur une erreur ou une réponse hors schéma :
 * une part prévue calculée sur un volume inventé serait fausse pour toutes les unités.
 */
export async function lireVolumesAttendus(supabase: ClientAdmin, codes: readonly string[]): Promise<VolumesAttendus> {
  const { data, error } = await supabase.rpc('volumes_attendus_cp', { p_codes: [...new Set(codes)] });
  if (error) throw new Error(`volumes_attendus_cp : ${error.message}`);
  const lu = VolumesSchema.parse(data);
  return { total: lu.total, par_code: new Map(Object.entries(lu.codes)) };
}

/** La ligne `HORS_ZONE` figée d'une extraction (`resume_plan`, sql/306). */
const LigneHorsZoneSchema = z.object({
  code: z.literal(CODE_HORS_ZONE),
  mode: z.enum(['strict', 'national']),
  multiplicateur: z.coerce.number(),
  part: z.literal(1),
  classe: z.coerce.number(),
  volume: z.coerce.number().nullable(),
  part_prevue: z.coerce.number().nullable(),
});
export type LigneHorsZoneFigee = z.infer<typeof LigneHorsZoneSchema>;

/**
 * La ligne `HORS_ZONE` d'une extraction, ou `null` si rien n'a été figé (extraction antérieure à sql/306, sans plan
 * CP, ou inconnue). Lève sur une erreur de lecture ou une ligne hors schéma.
 */
export async function lireHorsZone(supabase: ClientAdmin, extractionId: string): Promise<LigneHorsZoneFigee | null> {
  const { data, error } = await supabase.rpc('hors_zone_extraction', { p_extraction_id: extractionId });
  if (error) throw new Error(`hors_zone_extraction : ${error.message}`);
  return data === null || data === undefined ? null : LigneHorsZoneSchema.parse(data);
}
