/**
 * Les codes postaux que le référentiel ne sait pas distinguer.
 *
 * ── CE QUE CE FICHIER RÉSOUT ──────────────────────────────────────────────
 *
 * `ref_codes_postaux` porte la MÊME géométrie pour tous les codes postaux
 * d'une commune. Mesuré le 2026-09-22 : `ST_Equals(geom('44000'),
 * geom('44200'))` répond `true`, et les quatre codes postaux de Nantes
 * partagent jusqu'à leur centroïde. **71 groupes, 181 codes postaux**, le plus
 * gros à 6 membres.
 *
 * Aucun calcul ne peut donc dire dans lequel habite un exposé. Le rattachement
 * d'un carreau retient un code CANONIQUE (`cp_du_point`, sql/228), et le plan
 * achète **tout le groupe** — sans quoi on cible un quart d'une ville dont les
 * exposés sont répartis sur les quatre codes postaux.
 *
 * ⚠ Ce n'est PAS la même chose que le recouvrement partiel des contours
 * postaux (~14 % des carreaux, sql/221) : là, deux territoires se chevauchent
 * et un départage tranche honnêtement. Ici les contours sont IDENTIQUES —
 * l'information n'existe pas, et aucun départage ne la fera apparaître.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import type { MembresParCanonique } from '@/lib/zones/plan';

/**
 * Lit les groupes de codes postaux indiscernables.
 *
 * ⚠ **Une seule requête, sans pagination ni lots**, et c'est mesuré : seuls
 * les groupes de plus d'un membre sont lus, soit **181 lignes** sur les 6 187
 * de la table. Le plafond serveur `db-max-rows` (1 000) est hors d'atteinte,
 * et un `.in()` sur les codes du jeu coûterait plus cher que tout lire.
 *
 * ⚠ **L'erreur est LUE et relancée.** supabase-js ne lève pas : un échec
 * silencieux rendrait une carte vide, et le plan achèterait de nouveau un code
 * postal sur quatre — exactement le défaut que sql/228 ferme, rouvert par une
 * absence de `if (error)`.
 *
 * @returns Les membres par code canonique. Un code canonique absent de la
 *   carte est un code postal ordinaire : il n'a pas de groupe, et le plan
 *   l'émet tel quel.
 */
export async function lireGroupesCp(
  sb: SupabaseClient<Database>,
): Promise<MembresParCanonique> {
  const { data, error } = await sb
    .from('cp_groupe')
    .select('code_postal, code_canonique')
    .gt('n_membres', 1);

  if (error) throw new Error(`lecture de cp_groupe : ${error.message}`);

  const membres = new Map<string, string[]>();
  for (const ligne of data ?? []) {
    const liste = membres.get(ligne.code_canonique);
    if (liste) liste.push(ligne.code_postal);
    else membres.set(ligne.code_canonique, [ligne.code_postal]);
  }
  // Ordre stable : deux exécutions doivent produire le même fichier d'export
  // et les mêmes lignes de plan, dans le même ordre.
  for (const liste of membres.values()) liste.sort();
  return membres;
}
