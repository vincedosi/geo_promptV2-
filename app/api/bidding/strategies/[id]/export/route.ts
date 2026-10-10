/**
 * GET /api/bidding/strategies/[id]/export?channel=<code>
 *
 * Fichier custom bidding « fidèle à la pression » de la stratégie armée,
 * rendu selon le canal (dsp_channel_registry, rien de hardcodé) :
 *   • provider dv360  → script Python (paliers quantiles + hors-zone)
 *   • provider tiktok → fiche ad groups (pas de ciblage CP en France)
 *   • autres          → CSV générique `postal_code;score`
 *
 * Scores par CP = interpolation de la courbe de pression sur la variable
 * INSEE de la stratégie. Hors-zone = 0 (zones strictes / mode exclusion)
 * ou la valeur uniform (national avec surpression).
 *
 * Nano : requêtes séquentielles, valeurs INSEE par lots de 200 CP
 * (zone) ou paginées 1000 (national) — jamais > 3 appels parallèles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';
import { interpolateOnCurve } from '@/lib/strategy-wizard/multiplier';
import { resolveWeightingTarget } from '@/lib/bidding-ml/metric-labels';
import {
  binScoresIntoTiers, buildPressureBiddingScript, buildPressureCsv, buildTiktokPressureSheet,
} from '@/lib/digital/bidding-export';
import { toSlug } from '@/lib/custom-geo/slug';
import { lireCodesDeZone } from '@/lib/custom-geo/codes-zone';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Toutes les variables lisent indicator_cp_values (matérialisée au Lancement).
const INDICATOR_SOURCE = { table: 'indicator_cp_values', cpCol: 'postal_code', valCol: 'value' } as const;

const CHUNK = 200;
const PAGE = 1000;

interface StrategyRow {
  id: string;
  name: string;
  scope_type: 'national' | 'custom_zone';
  zone_id: string | null;
  weighting_mode: string | null;
  in_zone_weights: Record<string, unknown> | null;
  out_zone_weights: Record<string, unknown> | null;
}

function outZoneScoreOf(outWeights: Record<string, unknown> | null): number {
  const mode = (outWeights?.mode as string | undefined) ?? 'uniform';
  if (mode === 'exclusion') return 0;
  const v = Number(outWeights?.value ?? 1.0);
  return Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 1.0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { id } = await params;

  const channelCode = new URL(request.url).searchParams.get('channel');
  if (!channelCode) return NextResponse.json({ error: 'missing_channel' }, { status: 400 });

  const supabase = createAdminClient();
  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data: strategy, error: sErr } = await supabase
    .from('bidding_strategies')
    .select('id, name, scope_type, zone_id, weighting_mode, in_zone_weights, out_zone_weights')
    .eq('id', id)
    .single<StrategyRow>();
  if (sErr || !strategy) return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data: channel, error: chErr } = await supabase
    .from('dsp_channel_registry')
    .select('code, label, category, connection_provider')
    .eq('code', channelCode)
    .eq('active', true)
    .maybeSingle();
  if (chErr) return NextResponse.json({ error: chErr.message }, { status: 500 });
  if (!channel) return NextResponse.json({ error: 'unknown_channel', channel: channelCode }, { status: 404 });

  const inWeights = strategy.in_zone_weights ?? {};
  const target = resolveWeightingTarget(strategy.weighting_mode, inWeights);
  const curve = Array.isArray(inWeights.curve)
    ? (inWeights.curve as Array<{ x: number; y: number }>)
    : null;

  // ── CP dans le périmètre ──────────────────────────────────────────────────────
  let zoneCps: string[] | null = null; // null = national (toute la table variable)
  if (strategy.scope_type === 'custom_zone' && strategy.zone_id) {
    // Lecture paginée : une requête de table est coupée à 1 000 lignes
    // (`db-max-rows`) ; sans pagination, le fichier d'une zone de 1 641 CP en
    // portait 1 000, sans erreur (mesuré le 2026-10-10).
    let codes: string[];
    try {
      codes = await lireCodesDeZone(supabase, strategy.zone_id, 'cp');
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
    zoneCps = Array.from(new Set(codes.map((c) => c.trim()).filter(Boolean)));
    if (zoneCps.length === 0) {
      return NextResponse.json({ error: 'zone_without_cps' }, { status: 422 });
    }
  }

  // ── Valeurs indicateur par CP ──────────────────────────────────────────────────
  const values: Record<string, number> = {};
  // Le narrow porte sur `variableCode` lui-meme, pas sur un `source` qui en
  // derive : sinon le compilateur ignore que `indicator_code` est non-null dans
  // les `.eq()` ci-dessous.
  const variableCode = target.variableCode;
  if (variableCode) {
    const source = INDICATOR_SOURCE;
    if (zoneCps) {
      for (let i = 0; i < zoneCps.length; i += CHUNK) {
        const { data, error } = await supabase
          .from(source.table)
          .select(`${source.cpCol}, ${source.valCol}`)
          .eq('indicator_code', variableCode)
          .in(source.cpCol, zoneCps.slice(i, i + CHUNK));
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          values[String(r[source.cpCol])] = Number(r[source.valCol]);
        }
      }
    } else {
      // Pages triées sur `postal_code` : avec `indicator_code` fixé, c'est la
      // clé primaire (indicator_code, postal_code), donc un ordre TOTAL, servi
      // par l'index sans tri. Sans `order()` (jusqu'au 2026-10-11), rien ne
      // garantissait le même ordre d'une page à l'autre : pages qui se
      // recouvrent, codes postaux absents du fichier, sans erreur.
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from(source.table)
          .select(`${source.cpCol}, ${source.valCol}`)
          .eq('indicator_code', variableCode)
          .order(source.cpCol)
          .range(from, from + PAGE - 1);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
        for (const r of rows) values[String(r[source.cpCol])] = Number(r[source.valCol]);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }
    if (curve && Object.keys(values).length === 0) {
      return NextResponse.json({ error: 'indicator_not_materialized', variable: target.variableCode }, { status: 422 });
    }
  }

  /*
   * ── PLAN PAR JEU DE ZONES : ON LIT LE PLAN, ON NE LE REFAIT PAS ─────────
   *
   * Les autres modes reconstruisent le score en interpolant un indicateur
   * INSEE sur une courbe. Un plan issu d'un jeu de zones n'a pas d'indicateur
   * et pas de courbe : son multiplicateur a été calculé une fois, à partir des
   * classes et de leurs poids, et il est DÉJÀ écrit dans `bidding_zone_configs`.
   *
   * Sans cette branche, l'export rendait `no_scores` en 422 — `variableCode`
   * est null, donc `values` reste vide, donc `cps` aussi. Le plan existait, le
   * fichier refusait de le sortir.
   *
   * Le recalculer ici serait pire qu'inutile : ce serait une seconde
   * implémentation de `genererPlanCp`, qui finirait par diverger de celle qui
   * a réellement produit le plan que le DSP reçoit.
   */
  if (strategy.weighting_mode === 'by_zone_set') {
    const planScores: Record<string, number> = {};
    let debut = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('bidding_zone_configs')
        .select('postal_code, bid_multiplier')
        .eq('strategy_id', strategy.id)
        .eq('is_active', true)
        .order('postal_code')
        .range(debut, debut + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const lignes = data ?? [];
      for (const r of lignes) {
        // Même borne que les autres modes : le DSP refuse au-delà de ×5, et
        // laisser passer une valeur plus haute ferait rejeter le fichier
        // entier plutôt qu'une ligne.
        planScores[String(r.postal_code)] = Math.max(0, Math.min(5, Number(r.bid_multiplier)));
      }
      // ⚠ La pagination est OBLIGATOIRE : PostgREST plafonne les requêtes de
      // table à 1 000 lignes côté serveur, et un plan national en porte près
      // de 2 000. Un fichier custom bidding amputé de moitié ne se voit pas.
      if (lignes.length < PAGE) break;
      debut += PAGE;
    }
    if (Object.keys(planScores).length === 0) {
      return NextResponse.json(
        { error: 'plan_vide', detail: 'ce jeu de zones n’a écrit aucun code postal' },
        { status: 422 },
      );
    }
    const nomJeu = typeof inWeights.zone_set_nom === 'string' ? inWeights.zone_set_nom : null;
    /*
     * Ce que reçoit un code postal ABSENT du fichier, et les deux modes ne
     * répondent pas la même chose — c'est leur définition même :
     *
     *   · `exclusif` → 0. Zéro impression hors des codes postaux retenus. Un
     *     catch-all à ×1 rouvrirait la diffusion sur ce que le seuil de
     *     couverture vient justement d'écarter, et le mode ne garantirait plus
     *     rien.
     *   · `pondere` → 1. Toute la France reçoit du budget, les zones en
     *     reçoivent davantage. C'est la phrase que l'écran affiche au moment du
     *     choix, et le fichier doit la tenir.
     *
     * ⚠ Le jeu ne couvre que les codes postaux à moins de 10 km d'un site
     * classé — la portée du pré-calcul. En mode pondéré, le reste de la France
     * est donc « hors fichier » sans être « hors plan » : d'où le ×1.
     */
    const exclusif = inWeights.mode_plan === 'exclusif';
    return reponseFichier(strategy, channel, planScores, exclusif ? 0 : 1, {
      variableLabel: nomJeu ? `jeu de zones « ${nomJeu} »` : 'jeu de zones',
      national: false,
    });
  }

  // ── Scores par CP ─────────────────────────────────────────────────────────────
  const scores: Record<string, number> = {};
  const uniformIn = Number(inWeights.value ?? 1.0);
  const cps = zoneCps ?? Object.keys(values);
  for (const cp of cps) {
    if (curve) {
      const v = values[cp];
      // CP sans data → neutre ×1 (même convention que computeMultiplier)
      scores[cp] = v === undefined ? 1.0 : Math.max(0, Math.min(5, interpolateOnCurve(curve, v)));
    } else {
      scores[cp] = Number.isFinite(uniformIn) ? Math.max(0, Math.min(5, uniformIn)) : 1.0;
    }
  }
  if (Object.keys(scores).length === 0) {
    return NextResponse.json({ error: 'no_scores', detail: 'aucun CP avec données' }, { status: 422 });
  }

  // National : le catch-all du script couvre les CP absents du dataset → neutre ×1.
  const outZoneScore = zoneCps ? outZoneScoreOf(strategy.out_zone_weights) : 1.0;
  return reponseFichier(strategy, channel, scores, outZoneScore, {
    variableLabel: target.variableLabel ?? undefined,
    national: !zoneCps,
  });
}

/**
 * Fabrique le fichier custom bidding à partir de scores DÉJÀ calculés.
 *
 * Extraite le 2026-09-20, quand le plan par jeu de zones est devenu une
 * seconde source de scores : les deux chemins calculent leurs scores
 * autrement, mais doivent produire EXACTEMENT le même format de fichier.
 * Recopier la mise en forme aurait donné deux variantes du script DV360, dont
 * une seule aurait été corrigée au prochain changement de format.
 *
 * @param scores - Multiplicateur par code postal, déjà borné à [0 ; 5].
 * @param outZoneScore - Ce que reçoivent les codes postaux hors du fichier.
 * @param options.variableLabel - Ce qui a piloté le plan, écrit dans l'en-tête.
 * @param options.national - Vrai si le plan porte sur toute la France.
 */
function reponseFichier(
  strategy: { id: string; name: string },
  channel: { code: string; connection_provider: string | null },
  scores: Record<string, number>,
  outZoneScore: number,
  options: { variableLabel?: string; national?: boolean },
): Response {
  const scopeSuffix = options.national
    ? 'national'
    : outZoneScore > 0 ? 'national_surpression' : 'zones_strictes';
  const slug = toSlug(strategy.name);
  const maxScore = Math.max(...Object.values(scores));
  const pressureLabel = '×' + maxScore.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

  const provider = channel.connection_provider ?? channel.code;
  const tiers = binScoresIntoTiers(scores);

  if (provider === 'dv360') {
    const script = buildPressureBiddingScript(strategy.name, tiers, outZoneScore, {
      pressure: pressureLabel,
      variableLabel: options.variableLabel,
    });
    return new Response(script, {
      headers: {
        'Content-Type': 'text/x-python; charset=utf-8',
        'Content-Disposition': `attachment; filename="custom_bidding_${channel.code}_${slug}_${scopeSuffix}.py"`,
      },
    });
  }

  if (provider === 'tiktok') {
    const sheet = buildTiktokPressureSheet(strategy.name, tiers, outZoneScore);
    return new Response(sheet, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="custom_bidding_${channel.code}_${slug}_${scopeSuffix}.txt"`,
      },
    });
  }

  const csv = buildPressureCsv(scores);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="custom_bidding_${channel.code}_${slug}_${scopeSuffix}.csv"`,
    },
  });
}
