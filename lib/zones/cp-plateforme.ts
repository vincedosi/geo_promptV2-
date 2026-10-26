/**
 * @file lib/zones/cp-plateforme.ts — les codes postaux qu'une plateforme ACHÈTE dans une extraction figée (lot 7, T1,
 * arbitrage A-1).
 *
 * Une seule lecture pour quatre lecteurs : la route `GET …/extractions/[version]/cp` (tableau de ⑥), le pré-vol et la
 * poussée de ⑦ (`…/activation/prevol`, `…/activation/pousser`) et le fichier par plateforme (`…/fichier`). Les CP
 * comptés à l'écran sont donc ceux qui partent chez DV360 et ceux du fichier, à l'unité près.
 *
 * - sans `plateforme` : le plan CP de l'extraction (`multiplicateur > 0`, `lireCpExtraction`), celui que `rattacher`
 *   recopie ;
 * - avec : les CP de CETTE plateforme — ses unités retenues à la maille CP (`zone_set_extraction_unites`, sql/278),
 *   ramenées à leur code canonique pour garder un groupe de CP indiscernables entier, comme le plan l'achète. Une
 *   plateforme qui n'achète pas au CP (cercles, communes, polygone) rend une liste vide ;
 * - jeu RISQUE (extraction sans résumé `plateformes`) : il n'a ni plateformes ni unités, son plan CP EST ce que
 *   chaque plateforme au CP achète — le plan entier, jamais une liste vide (Review Focus 2 du lot 7).
 *
 * Les lignes rendues sont en codes postaux BRUTS (un groupe indiscernable : une ligne par membre), l'unité que
 * `rattacher` écrit dans `bidding_zone_configs`.
 */
import { lireTout } from '@/lib/supabase/lire-tout';
import { PLAFOND_CP_PLAN, lireCpExtraction, type ClientAdmin, type LigneCpExtraction } from '@/lib/zones/plan-extraction';

/**
 * Les CP achetés d'une extraction, pour une plateforme ou pour toutes.
 *
 * ⚠ Lectures PAGINÉES (`db-max-rows = 1000`) : les CP d'une plateforme nationale dépassent le millier.
 *
 * @param extractionId - L'extraction, déjà rattachée à un jeu vérifié dans l'espace par l'appelant.
 * @param plateforme - `dv360`, `ttd`, `meta`, `tiktok` ; absente : le plan CP entier.
 * @throws {Error} Si une lecture échoue ou si un plafond est franchi (`lireTout`).
 */
export async function lireCpPlateforme(
  supabase: ClientAdmin, extractionId: string, plateforme?: string,
): Promise<LigneCpExtraction[]> {
  const lignes = await lireCpExtraction(supabase, extractionId);
  if (!plateforme) return lignes;

  // Le résumé par plateforme distingue un jeu de zone (tableau) d'un jeu risque (`null`) : une ligne par la clé.
  const { data: x, error } = await supabase
    .from('zone_set_extractions').select('plateformes').eq('id', extractionId).maybeSingle();
  if (error) throw new Error(`résumé de l’extraction : ${error.message}`);
  if (!Array.isArray(x?.plateformes)) return lignes;

  const { lignes: unites } = await lireTout<{ code: string | null }>(
    (de, a) => supabase
      .from('zone_set_extraction_unites')
      .select('code')
      .eq('extraction_id', extractionId)
      .eq('plateforme', plateforme)
      .eq('maille', 'cp')
      .eq('retenu', true)
      .order('ordinal')
      .range(de, a),
    PLAFOND_CP_PLAN,
  );
  // Une unité peut nommer un MEMBRE de groupe (liste exacte d'une recette) : on la ramène à son canonique.
  const canoniqueDe = new Map(lignes.map((l) => [l.code_postal, l.code_canonique]));
  const achetes = new Set(unites.flatMap((u) => (u.code ? [canoniqueDe.get(u.code) ?? u.code] : [])));
  return lignes.filter((l) => achetes.has(l.code_canonique));
}
