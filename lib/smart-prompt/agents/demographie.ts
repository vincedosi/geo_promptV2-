/**
 * lib/smart-prompt/agents/demographie.ts
 * Agent démographie — interroge les RPCs smart_demographie_stats
 * et smart_demographie_ranking via Supabase.
 *
 * Retourne des TOTAUX (SUM) pour les indicateurs de comptage,
 * et la MÉDIANE pour les indicateurs non-sommables (revenu, surface).
 */

import { createAdminClient }          from '@/lib/auth';
import { logger } from '@/lib/logger';
import { resolveCityCenter }           from '../geo-resolver';
import { CHORO_INDICATORS }            from '@/lib/chat/system-prompt';
import type { AgentResult, DemoStats } from '../types';

// Résultat d'une ligne de ranking villes
interface TopVilleRow {
  rang:  number;
  ville: string;
  total: number;
  lat:   number;
  lng:   number;
}

function buildRankingMarkdown(
  rows:        TopVilleRow[],
  indicateur:  string,
  rayon_km:    number,
): string {
  const label = INDICATEUR_LABELS[indicateur] ?? indicateur;
  const header = [
    `## Top ${rows.length} villes — ${label}`,
    `_Rayon ${rayon_km} km autour du centre de chaque ville · carreaux INSEE 200m_`,
    '',
    `| # | Ville | ${label} |`,
    `|---|-------|${'-'.repeat(label.length + 2)}|`,
  ];
  const rowLines = rows.map(r =>
    `| ${r.rang} | **${r.ville}** | ${Math.round(r.total).toLocaleString('fr-FR')} |`
  );
  return [...header, ...rowLines].join('\n');
}

// Labels lisibles pour chaque colonne Filosofi
const INDICATEUR_LABELS: Record<string, string> = {
  ind:       'Population totale',
  ind_inc:   'Population inconnue',
  ind_0_3:   '0-3 ans',
  ind_4_5:   '4-5 ans',
  ind_6_10:  '6-10 ans',
  ind_11_17: '11-17 ans',
  ind_18_24: '18-24 ans',
  ind_25_39: '25-39 ans',
  ind_40_54: '40-54 ans',
  ind_55_64: '55-64 ans',
  ind_65_79: '65-79 ans',
  ind_80p:   '80 ans et +',
  men:       'Ménages',
  men_pauv:  'Ménages pauvres',
  men_1ind:  'Personnes seules',
  men_5ind:  'Ménages 5+ personnes',
  men_prop:  'Propriétaires',
  men_fmp:   'Familles monoparentales',
  men_mais:  'Maisons',
  men_coll:  'Logements collectifs',
  men_surf:  'Surface moyenne (m²)',
  ind_snv:   'Revenu médian',
  log_av45:  'Logements avant 1945',
  log_45_70: 'Logements 1945-1970',
  log_70_90: 'Logements 1970-1990',
  log_ap90:  'Logements après 1990',
  log_soc:   'Logements sociaux',
  log_inc:   'Logements inconnus',
};

// Indicateurs non-sommables : on affiche la MÉDIANE, pas le total
const NON_SUMMABLE = new Set(['ind_snv', 'men_surf']);

function buildMarkdown(
  stats:       DemoStats,
  indicateur:  string,
  zoneName:    string,
): string {
  const label   = INDICATEUR_LABELS[indicateur] ?? indicateur;
  const context = `_Rayon ${stats.rayon_km} km · ${stats.nb_carreaux.toLocaleString('fr-FR')} carreaux INSEE 200m_`;

  // Indicateurs non-sommables : revenu_moyen_pers pour ind_snv, médiane pour men_surf
  if (NON_SUMMABLE.has(indicateur)) {
    const isRevenu = indicateur === 'ind_snv';

    if (isRevenu) {
      // Revenu moyen pondéré par personne = SUM(ind_snv) / SUM(ind)
      const revenu   = Math.round(stats.revenu_moyen_pers);
      const revenuFmt = revenu.toLocaleString('fr-FR');
      const REF_FRANCE = 22_430; // Filosofi 2019
      const delta      = ((revenu - REF_FRANCE) / REF_FRANCE) * 100;
      const sign       = delta >= 0 ? '+' : '';

      return [
        `## Revenu moyen — ${zoneName}`,
        context,
        '',
        `**${revenuFmt} €/an** par habitant`,
        '',
        `**vs France (~22 430 €) :** ${sign}${delta.toFixed(1)}%`,
      ].join('\n');
    }

    // Surface moyenne (men_surf)
    return [
      `## ${label} — ${zoneName}`,
      context,
      '',
      `**${Math.round(stats.mediane)} m²** (médiane par ménage)`,
    ].join('\n');
  }

  // Indicateurs de comptage : TOTAL (SUM) en headline
  const totalFmt = Math.round(stats.total).toLocaleString('fr-FR');

  const lines = [
    `## ${label} — ${zoneName}`,
    context,
    '',
    `**${totalFmt}** ${label.toLowerCase()}`,
    '',
    `| Détail | Par carreau |`,
    `|--------|-------------|`,
    `| Maximum | ${Math.round(stats.max).toLocaleString('fr-FR')} |`,
    `| Moyenne | ${Math.round(stats.moyenne).toLocaleString('fr-FR')} |`,
  ];

  return lines.join('\n');
}

export async function runDemographieAgent(
  params: Record<string, unknown>,
): Promise<AgentResult> {
  const ville      = params.ville  ? String(params.ville)  : undefined;
  const region     = params.region ? String(params.region) : undefined;
  const indicateur = params.indicateur ? String(params.indicateur) : 'ind_snv';
  const rayon_km   = params.rayon_km ? Number(params.rayon_km) : 5;
  const limit      = params.limit ? Number(params.limit) : 10;
  // Si aucune ville/région précise → ranking national par défaut
  const defaultMode = (!ville && !region) ? 'ranking' : 'stats';
  const mode        = params.mode ? String(params.mode) : defaultMode;

  // Mode ranking : top N villes de France
  if (mode === 'ranking') {
    const validIndicateurs   = Object.keys(CHORO_INDICATORS);
    const resolvedIndicateur = validIndicateurs.includes(indicateur) ? indicateur : 'ind_18_24';
    const sb = createAdminClient();

    logger.debug('demographie', `ranking → ${{ resolvedIndicateur, rayon_km, limit }}`);
    const t0 = Date.now();

    const { data, error } = await sb.rpc('smart_demographie_top_villes', {
      p_indicateur: resolvedIndicateur,
      p_rayon_km:   rayon_km,
      p_limit:      limit,
    });

    logger.debug('demographie', `ranking RPC took ${Date.now() - t0} ms — error: ${error?.message ?? 'none'}`);

    if (error) {
      return { agent: 'demographie', success: false, error: error.message };
    }

    const rows = (data ?? []) as TopVilleRow[];
    logger.debug('demographie', `ranking rows ${rows.length}`);

    if (!rows.length) {
      return { agent: 'demographie', success: false, error: 'Aucune ville trouvée pour cet indicateur.' };
    }

    const label = INDICATEUR_LABELS[resolvedIndicateur] ?? resolvedIndicateur;
    return {
      agent:       'demographie',
      success:     true,
      data:        { rows, indicateur: resolvedIndicateur, mode: 'ranking' },
      explication: `Top ${rows.length} villes par ${label.toLowerCase()}`,
      markdown:    buildRankingMarkdown(rows, resolvedIndicateur, rayon_km),
    };
  }

  // Valider l'indicateur contre CHORO_INDICATORS
  const validIndicateurs   = Object.keys(CHORO_INDICATORS);
  const resolvedIndicateur = validIndicateurs.includes(indicateur) ? indicateur : 'ind_snv';

  // resolveCityCenter retourne [lng, lat] (ordre GeoJSON)
  const zoneName = ville ?? region ?? 'France';
  const centre   = await resolveCityCenter(zoneName);
  const lng      = centre ? centre[0] : 2.3522;
  const lat      = centre ? centre[1] : 48.8566;

  const sb = createAdminClient();

  const { data, error } = await sb.rpc('smart_demographie_stats', {
    p_lat:        lat,
    p_lng:        lng,
    p_indicateur: resolvedIndicateur,
    p_rayon_km:   rayon_km,
  });

  if (error) {
    return { agent: 'demographie', success: false, error: error.message };
  }

  const stats = data as DemoStats;
  if (stats.error) {
    return { agent: 'demographie', success: false, error: stats.error };
  }

  // La RPC ne retourne pas revenu_moyen_pers — on calcule SUM(ind_snv)/SUM(ind)
  if (resolvedIndicateur === 'ind_snv' && stats.total > 0) {
    const { data: popData } = await sb.rpc('smart_demographie_stats', {
      p_lat:        lat,
      p_lng:        lng,
      p_indicateur: 'ind',
      p_rayon_km:   rayon_km,
    });
    const popTotal = ((popData ?? {}) as { total?: number }).total ?? 0;
    stats.revenu_moyen_pers = popTotal > 0 ? Math.round(stats.total / popTotal) : 0;
  } else {
    stats.revenu_moyen_pers = 0;
  }

  const label    = INDICATEUR_LABELS[resolvedIndicateur] ?? resolvedIndicateur;
  const isTotal  = !NON_SUMMABLE.has(resolvedIndicateur);
  const headline = resolvedIndicateur === 'ind_snv'
    ? `Revenu moyen à ${zoneName} : ${stats.revenu_moyen_pers.toLocaleString('fr-FR')} €/an par habitant`
    : isTotal
      ? `${Math.round(stats.total).toLocaleString('fr-FR')} ${label.toLowerCase()} à ${zoneName}`
      : `Surface médiane à ${zoneName} : ${Math.round(stats.mediane)} m²`;

  return {
    agent:       'demographie',
    success:     true,
    data:        { ...stats, centre: centre ?? [lng, lat], indicateur: resolvedIndicateur },
    explication: headline,
    markdown:    buildMarkdown(stats, resolvedIndicateur, zoneName),
  };
}
