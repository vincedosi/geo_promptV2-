/**
 * MAGELIAN — générateur de script custom bidding DV360 pour une zone custom.
 *
 * Syntaxe officielle (référence Google « Custom bidding script reference ») :
 *   return max_aggregate([([critère_a, critère_b], score), ...])
 * - critères entre crochets, virgule = AND
 * - signal `zip_postal_code` (String, code postal brut — pas de geo ID)
 * - signal `country_code` (String)
 * - fonctions d'agrégation : first_match_aggregate | max_aggregate | sum_aggregate
 * - interdits : boucles, def, is/is not, opérateurs bit à bit
 *
 * Le script note 1.0 les impressions dans la zone, 0.0 ailleurs. Les scores
 * sont relatifs : le modèle DV360 concentre les enchères sur les scores hauts.
 *
 * Utilisé par l'export fichier (/api/custom-geo/[id]/export?format=bidding_script) ;
 * réutilisable tel quel par le futur push API (customBiddingAlgorithms.scripts).
 */

export interface BiddingScriptOptions {
  /** Score des impressions dans la zone (défaut 1.0) */
  inZoneScore?: number;
  /** Score hors zone (défaut 0.0) */
  outZoneScore?: number;
}

/** Construit le script custom bidding DV360 d'une zone (codes postaux français). */
export function buildZoneBiddingScript(
  zoneName: string,
  postalCodes: string[],
  options: BiddingScriptOptions = {},
): string {
  // 1.0 plutôt que 1 : littéral float explicite dans le script généré
  const fmt = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  const inZone = fmt(options.inZoneScore ?? 1.0);
  const outZone = fmt(options.outZoneScore ?? 0.0);
  const cps = postalCodes.map((cp) => `"${cp.trim()}"`).join(', ');

  return [
    `# MAGELIAN — custom bidding « ${zoneName} »`,
    `# Zone : ${postalCodes.length} codes postaux France. Score ${inZone} dans la zone, ${outZone} ailleurs.`,
    `# À coller dans DV360 : Custom bidding > Scripted > nouvel algorithme.`,
    'return max_aggregate([',
    `  ([country_code == "FR", zip_postal_code in [${cps}]], ${inZone}),`,
    `  ([], ${outZone})`,
    '])',
    '',
  ].join('\n');
}
