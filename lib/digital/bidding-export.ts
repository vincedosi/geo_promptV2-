/**
 * MAGELIAN — export custom bidding « fidèle à la pression » d'une stratégie.
 *
 * Depuis les scores par code postal (interpolés sur la courbe de pression,
 * variable INSEE), produit les livrables par plateforme :
 *   • buildPressureBiddingScript — script Python DV360 (paliers quantiles)
 *   • buildPressureCsv           — CSV générique `postal_code;score` (autres DSP)
 *   • buildTiktokPressureSheet   — fiche ad groups TikTok (pas de ciblage CP en FR)
 *
 * Logique pure, sans I/O — la route /api/bidding/strategies/[id]/export
 * fournit les scores et choisit le rendu selon dsp_channel_registry.
 */

export interface PressureTier {
  /** Libellé du palier (ex. « Palier 1 »). */
  label: string;
  /** Score représentatif du palier (moyenne des CP du groupe). */
  score: number;
  /** Codes postaux du palier. */
  cps: string[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Regroupe les scores par CP en ≤ nTiers paliers contigus (quantiles par
 * effectif). Deux CP au même score ne sont jamais séparés dans deux paliers.
 * Score du palier = moyenne des scores du groupe (arrondi 3 décimales).
 */
export function binScoresIntoTiers(
  scores: Record<string, number>,
  nTiers = 5,
): PressureTier[] {
  const entries = Object.entries(scores)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return [];

  const uniqueScores = Array.from(new Set(entries.map(([, v]) => round3(v))));
  const groups: Array<Array<[string, number]>> = [];

  if (uniqueScores.length <= nTiers) {
    // Un palier par score distinct
    for (const s of uniqueScores) {
      groups.push(entries.filter(([, v]) => round3(v) === s));
    }
  } else {
    // Découpe par effectif, frontière déplacée pour ne pas couper un score égal
    const target = entries.length / nTiers;
    let start = 0;
    for (let g = 0; g < nTiers && start < entries.length; g++) {
      let end = g === nTiers - 1 ? entries.length : Math.round((g + 1) * target);
      // Étend la frontière tant que le score y est identique (pas de coupe intra-score)
      while (end < entries.length && round3(entries[end][1]) === round3(entries[end - 1][1])) end++;
      if (end <= start) end = start + 1;
      groups.push(entries.slice(start, end));
      start = end;
    }
  }

  return groups
    .filter((g) => g.length > 0)
    .map((g, i) => ({
      label: `Palier ${i + 1}`,
      score: round3(g.reduce((s, [, v]) => s + v, 0) / g.length),
      cps: g.map(([cp]) => cp),
    }));
}

/** Littéral float Python (1 → "1.0"). */
const pyFloat = (n: number): string => {
  const r = round3(n);
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
};

/**
 * Script custom bidding DV360 « fidèle à la pression » : un palier de score
 * par groupe de CP, palier final = score hors zone (0.0 strict, 1.0 national).
 * Syntaxe : voir référence en tête de dv360-bidding-script.ts.
 */
export function buildPressureBiddingScript(
  strategyName: string,
  tiers: PressureTier[],
  outZoneScore: number,
  meta?: { pressure?: string; variableLabel?: string },
): string {
  const tierLines = tiers.flatMap((t) => {
    if (!t.cps.length) return [`  # ${t.label} — aucun code postal`];
    const cps = t.cps.map((cp) => `"${cp.trim()}"`).join(', ');
    return [
      `  # ${t.label} — ${t.cps.length} CP, score ${pyFloat(t.score)}`,
      `  ([country_code == "FR", zip_postal_code in [${cps}]], ${pyFloat(t.score)}),`,
    ];
  });
  const metaLine = [
    meta?.pressure ? `pression ${meta.pressure}` : null,
    meta?.variableLabel ?? null,
  ].filter(Boolean).join(' · ');

  return [
    `# MAGELIAN — custom bidding « ${strategyName} »`,
    ...(metaLine ? [`# ${metaLine}`] : []),
    `# ${tiers.length} paliers de score, ${pyFloat(outZoneScore)} hors zone.`,
    `# À coller dans DV360 : Custom bidding > Scripted > nouvel algorithme.`,
    'return max_aggregate([',
    ...tierLines,
    `  ([], ${pyFloat(outZoneScore)})`,
    '])',
    '',
  ].join('\n');
}

/**
 * CSV générique `postal_code;score` (décimale point), scores exacts par CP,
 * tri score décroissant. Importable/transposable dans tout DSP sans format dédié.
 */
export function buildPressureCsv(scores: Record<string, number>): string {
  const rows = Object.entries(scores)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cp, v]) => `${cp};${round3(v)}`);
  return ['postal_code;score', ...rows, ''].join('\n');
}

/**
 * Fiche TikTok : pas de ciblage par CP en France ni de pondération intra
 * ad group → un ad group par palier, part de budget ∝ score × nb de CP.
 */
export function buildTiktokPressureSheet(
  strategyName: string,
  tiers: PressureTier[],
  outZoneScore: number,
): string {
  const totalWeight = tiers.reduce((s, t) => s + t.score * t.cps.length, 0);
  const pct = (t: PressureTier): string => {
    if (totalWeight <= 0) return '—';
    return ((t.score * t.cps.length / totalWeight) * 100)
      .toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
  };
  return [
    `Stratégie : ${strategyName} — custom bidding fidèle à la pression`,
    '',
    'TikTok ne supporte ni le ciblage par code postal en France, ni la pondération',
    "dans un même ad group → créer UN AD GROUP PAR PALIER avec sa part de budget,",
    'ciblage Localisation sur les villes/zones couvertes par les CP listés.',
    outZoneScore > 0
      ? 'Diffusion nationale : garder un ad group « France entière » à la base.'
      : 'Zones strictes : aucune diffusion hors des paliers ci-dessous.',
    '',
    ...tiers.flatMap((t) => [
      `── ${t.label} — score ${round3(t.score)} · ${pct(t)} du budget suggéré ──`,
      `  ${t.cps.length} codes postaux : ${t.cps.join(', ')}`,
      '',
    ]),
  ].join('\n');
}
