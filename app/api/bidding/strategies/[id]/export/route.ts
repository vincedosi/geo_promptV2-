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
    const { data: codes, error: zErr } = await supabase
      .from('custom_geo_zone_codes')
      .select('code')
      .eq('zone_id', strategy.zone_id)
      .eq('code_type', 'cp');
    if (zErr) return NextResponse.json({ error: zErr.message }, { status: 500 });
    zoneCps = Array.from(new Set((codes ?? []).map((r) => (r.code as string).trim()).filter(Boolean)));
    if (zoneCps.length === 0) {
      return NextResponse.json({ error: 'zone_without_cps' }, { status: 422 });
    }
  }

  // ── Valeurs indicateur par CP ──────────────────────────────────────────────────
  const values: Record<string, number> = {};
  const source = target.variableCode ? INDICATOR_SOURCE : null;
  if (source) {
    if (zoneCps) {
      for (let i = 0; i < zoneCps.length; i += CHUNK) {
        const { data, error } = await supabase
          .from(source.table)
          .select(`${source.cpCol}, ${source.valCol}`)
          .eq('indicator_code', target.variableCode)
          .in(source.cpCol, zoneCps.slice(i, i + CHUNK));
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          values[String(r[source.cpCol])] = Number(r[source.valCol]);
        }
      }
    } else {
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from(source.table)
          .select(`${source.cpCol}, ${source.valCol}`)
          .eq('indicator_code', target.variableCode)
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
  const scopeSuffix = !zoneCps ? 'national' : outZoneScore > 0 ? 'national_surpression' : 'zones_strictes';
  const slug = toSlug(strategy.name);
  const maxScore = Math.max(...Object.values(scores));
  const pressureLabel = '×' + maxScore.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

  const provider = channel.connection_provider ?? channel.code;
  const tiers = binScoresIntoTiers(scores);

  if (provider === 'dv360') {
    const script = buildPressureBiddingScript(strategy.name, tiers, outZoneScore, {
      pressure: pressureLabel,
      variableLabel: target.variableLabel ?? undefined,
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
