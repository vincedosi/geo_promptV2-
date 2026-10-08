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

export interface WeightedBiddingTier {
  /** Nom de l'item (ex. « CIRFA Rennes ») — commentaire dans le script. */
  name: string;
  /** Codes postaux de l'item. */
  cps: string[];
  /** Score 0-1 (part de répartition du plan média ÷ 100). */
  score: number;
}

/**
 * Script custom bidding DV360 pondéré : un palier de score par item de zone
 * (les % de répartition du plan média). max_aggregate garde le score le plus
 * haut si un CP apparaissait dans deux paliers.
 */
export function buildWeightedZoneBiddingScript(
  zoneName: string,
  tiers: WeightedBiddingTier[],
): string {
  const fmt = (n: number): string => {
    const r = Math.round(n * 1000) / 1000;
    return Number.isInteger(r) ? r.toFixed(1) : String(r);
  };
  const sorted = [...tiers].sort((a, b) => b.score - a.score);
  const tierLines = sorted.flatMap(t => {
    if (!t.cps.length) return [`  # ${t.name} — aucun code postal affecté`];
    const cps = t.cps.map(cp => `"${cp.trim()}"`).join(', ');
    return [
      `  # ${t.name} — ${(t.score * 100).toFixed(1)} % du plan`,
      `  ([country_code == "FR", zip_postal_code in [${cps}]], ${fmt(t.score)}),`,
    ];
  });

  return [
    `# dentsu.explore — custom bidding pondéré « ${zoneName} »`,
    `# ${sorted.length} zones, scores = répartition du plan média (0-1).`,
    `# À coller dans DV360 : Custom bidding > Scripted > nouvel algorithme.`,
    'return max_aggregate([',
    ...tierLines,
    '  ([], 0.0)',
    '])',
    '',
  ].join('\n');
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
    `# dentsu.explore — custom bidding « ${zoneName} »`,
    `# Zone : ${postalCodes.length} codes postaux France. Score ${inZone} dans la zone, ${outZone} ailleurs.`,
    `# À coller dans DV360 : Custom bidding > Scripted > nouvel algorithme.`,
    'return max_aggregate([',
    `  ([country_code == "FR", zip_postal_code in [${cps}]], ${inZone}),`,
    `  ([], ${outZone})`,
    '])',
    '',
  ].join('\n');
}
