/**
 * GENESIS — POST /api/admin/campaigns/import
 * Import DSP campaign file (CSV/XLSX) with SSE streaming progress.
 *
 * Backed by lib/dsp-mapping/* — mappings dynamiques (zéro hardcode DSP).
 * Parses file, batch-inserts into dsp_campaign_data, triggers IRIS matching.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { loadMappings } from '@/lib/dsp-mapping/loader';
import { parseFile } from '@/lib/dsp-mapping/parser';
import {
  MissingRequiredColumnError,
  NoMappingsFoundError,
} from '@/lib/dsp-mapping/types';
import type { CampaignImportEvent } from '@/types/campaign';
import { resolveImportScope } from '@/lib/campaigns/import-scope';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;

const ImportFieldsSchema = z.object({
  // Plus d'enum hardcodé : on accepte n'importe quelle string ; loadMappings()
  // tranchera (NoMappingsFoundError si pas de mapping en base).
  dsp_source: z.string().trim().min(1).max(50).default('adform'),
  campaign_name: z.string().trim().max(200).optional().nullable(),
  organization_id: z.string().uuid().optional().nullable(),
  campaign_id: z.string().uuid().optional().nullable(),
});

function badRequest(message: string, details?: unknown) {
  return new Response(JSON.stringify({ error: message, details }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface InsertRow {
  campaign_id: string;
  date: string | null;
  city: string | null;
  country: string;
  postal_code: string | null;
  region: string | null;
  dma_region: string | null;
  tracked_ads: number;
  media: string | null;
  unique_impressions: number;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  metrics: Record<string, unknown>;
  dsp_source: string;
}

function buildAggKey(row: InsertRow): string {
  return `${row.date ?? ''}|${row.postal_code ?? ''}|${row.city ?? ''}|${row.media ?? ''}`;
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  // ── Parse formData BEFORE creating the stream ─────────────────────
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return badRequest('Fichier manquant');
  }

  const parsedFields = ImportFieldsSchema.safeParse({
    dsp_source: formData.get('dsp_source') ?? undefined,
    campaign_name: formData.get('campaign_name'),
    organization_id: formData.get('organization_id'),
    campaign_id: formData.get('campaign_id'),
  });

  if (!parsedFields.success) {
    return badRequest('Paramètres invalides', parsedFields.error.flatten());
  }

  const dspSource = parsedFields.data.dsp_source.toLowerCase();
  const campaignNameOverride = parsedFields.data.campaign_name ?? null;
  const requestedOrgId = parsedFields.data.organization_id ?? null;
  const requestedCampaignId = parsedFields.data.campaign_id ?? null;

  // organization_id : super_admin peut viser n'importe quelle org ; sinon forcer celle du profil
  let organizationId: string;
  if (requestedOrgId) {
    if (profile.role !== 'super_admin' && requestedOrgId !== profile.organization_id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: organization_id hors scope' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
    organizationId = requestedOrgId;
  } else {
    organizationId = profile.organization_id || '00000000-0000-0000-0000-000000000001';
  }

  // ── Charger les mappings AVANT le stream pour échouer net si DSP inconnu ──
  let mappings;
  try {
    mappings = await loadMappings(dspSource);
  } catch (err) {
    if (err instanceof NoMappingsFoundError) {
      return badRequest(err.message, { code: 'no_mappings_found', dsp_source: err.dspSource });
    }
    return badRequest(
      `Erreur chargement mappings : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Cible : campagne existante (optionnel) — créer le client tôt pour la pré-vérif ──
  const supabase = createAdminClient();
  let existingCampaign: { id: string; organization_id: string | null; dsp_source: string | null } | null = null;
  if (requestedCampaignId) {
    const { data: camp, error: campLookupErr } = await supabase
      .from('dsp_campaigns')
      .select('id, organization_id, dsp_source')
      .eq('id', requestedCampaignId)
      .single();
    if (campLookupErr && campLookupErr.code !== 'PGRST116') {
      return new Response(JSON.stringify({ error: 'campaign_lookup_failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!camp) {
      return new Response(JSON.stringify({ error: 'campaign_not_found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const scope = resolveImportScope(profile.role, profile.organization_id, camp.organization_id);
    if (!scope.allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden', reason: scope.reason }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }
    existingCampaign = camp;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: CampaignImportEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      };

      try {
        send({ type: 'parsing', message: `Parsing ${fileName}…` });

        let parsed;
        try {
          parsed = parseFile(buffer, fileName, mappings);
        } catch (err) {
          if (err instanceof MissingRequiredColumnError) {
            send({
              type: 'error',
              message: `Colonnes requises manquantes : ${err.missingColumns.join(', ')}`,
            });
            controller.close();
            return;
          }
          throw err;
        }

        if (parsed.validationErrors.length > 0 && parsed.totalRows === 0) {
          send({
            type: 'error',
            message: `Aucune ligne valide. Erreurs : ${parsed.validationErrors.slice(0, 5).join('; ')}`,
          });
          controller.close();
          return;
        }

        const campaignName = campaignNameOverride?.trim() || parsed.campaignName;
        const totalRows = parsed.totalRows;

        send({
          type: 'progress',
          processed: 0,
          total: totalRows,
          message: `${totalRows} lignes détectées, ${parsed.countries.length} pays`,
        });

        // ── Cibler la campagne : existante (append) ou nouvelle ─────────
        // supabase est déjà créé avant le stream (pré-vérif campaign_id).
        let campaignId: string;
        let effectiveOrgId = organizationId;
        if (existingCampaign) {
          campaignId = existingCampaign.id;
          effectiveOrgId = existingCampaign.organization_id ?? organizationId;
          if (existingCampaign.dsp_source && existingCampaign.dsp_source !== dspSource) {
            send({
              type: 'progress',
              processed: 0,
              total: totalRows,
              message: `Attention : campagne cible '${existingCampaign.dsp_source}', fichier '${dspSource}'. La métrique de pacing suit le dsp_source de la campagne.`,
            });
          }
        } else {
          const { data: campaign, error: campErr } = await supabase
            .from('dsp_campaigns')
            .insert({
              name: campaignName,
              dsp_source: dspSource,
              advertiser: null,
              date_start: parsed.dateStart,
              date_end: parsed.dateEnd,
              total_tracked_ads: parsed.totalTrackedAds,
              total_unique_impressions: parsed.totalUniqueImpressions,
              countries: parsed.countries,
              created_by: profile.id,
              organization_id: organizationId,
            })
            .select('id')
            .single();
          if (campErr || !campaign) {
            send({ type: 'error', message: `Erreur création campagne : ${campErr?.message ?? 'inconnue'}` });
            controller.close();
            return;
          }
          campaignId = campaign.id;
        }

        // Lier l'org propriétaire dans la table pivot multi-org
        await supabase
          .from('campaign_organizations')
          .upsert(
            { campaign_id: campaignId, organization_id: effectiveOrgId, added_by: profile.id },
            { onConflict: 'campaign_id,organization_id', ignoreDuplicates: true },
          );

        // ── Construire les rows DB depuis ParsedRow ─────────────────────
        const insertRows: InsertRow[] = parsed.rows.map((p) => ({
          campaign_id: campaignId,
          date: (p.core.date as string | undefined) ?? null,
          city: (p.dimensions.city as string | undefined) ?? null,
          country: (p.core.country as string | undefined) ?? (p.dimensions.country as string | undefined) ?? '',
          postal_code: (p.core.postal_code as string | undefined) ?? null,
          region: (p.dimensions.region as string | undefined) ?? null,
          dma_region: (p.dimensions.dma_region as string | undefined) ?? null,
          tracked_ads: (p.core.tracked_ads as number | undefined) ?? 0,
          media: (p.dimensions.media as string | undefined) ?? null,
          unique_impressions: (p.core.unique_impressions as number | undefined) ?? 0,
          impressions: (p.core.impressions as number | undefined) ?? null,
          clicks: (p.core.clicks as number | undefined) ?? null,
          spend: (p.core.spend as number | undefined) ?? null,
          metrics: p.metrics,
          dsp_source: dspSource,
        }));

        // ── Pre-aggregate duplicates (same date+postal_code+city+media) ──
        // On agrège tracked_ads, unique_impressions, impressions, clicks et
        // les clés numériques de metrics. Les autres champs prennent la
        // première valeur rencontrée (déterministe : ordre du CSV).
        const aggMap = new Map<string, InsertRow>();

        for (const r of insertRows) {
          const key = buildAggKey(r);
          const existing = aggMap.get(key);
          if (existing) {
            existing.tracked_ads += r.tracked_ads;
            existing.unique_impressions += r.unique_impressions;
            if (r.impressions !== null) {
              existing.impressions = (existing.impressions ?? 0) + r.impressions;
            }
            if (r.clicks !== null) {
              existing.clicks = (existing.clicks ?? 0) + r.clicks;
            }
            if (r.spend !== null) {
              existing.spend = (existing.spend ?? 0) + r.spend;
            }
            // Merge metrics : sum si numérique, override sinon (cas rare)
            for (const [mk, mv] of Object.entries(r.metrics)) {
              if (typeof mv === 'number') {
                const cur = existing.metrics[mk];
                existing.metrics[mk] = (typeof cur === 'number' ? cur : 0) + mv;
              } else if (existing.metrics[mk] === undefined) {
                existing.metrics[mk] = mv;
              }
            }
          } else {
            aggMap.set(key, { ...r, metrics: { ...r.metrics } });
          }
        }

        const dedupedRows = Array.from(aggMap.values());
        const dedupedTotal = dedupedRows.length;

        if (dedupedTotal < totalRows) {
          send({
            type: 'progress',
            processed: 0,
            total: dedupedTotal,
            message: `${totalRows - dedupedTotal} doublons agrégés → ${dedupedTotal} lignes uniques`,
          });
        }

        // Append idempotent : si on cible une campagne existante, purger la délivrance
        // de la plage de dates du fichier avant réinsertion. (Le vrai index unique est une
        // expression COALESCE non inférable par onConflict — d'où DELETE+insert plutôt qu'upsert.)
        if (existingCampaign && parsed.dateStart && parsed.dateEnd) {
          const { error: purgeErr } = await supabase
            .from('dsp_campaign_data')
            .delete()
            .eq('campaign_id', campaignId)
            .gte('date', parsed.dateStart)
            .lte('date', parsed.dateEnd);
          if (purgeErr) {
            send({ type: 'error', message: `Erreur purge période : ${purgeErr.message}` });
            controller.close();
            return;
          }
        }

        // ── Batch insert rows ───────────────────────────────────────────
        let inserted = 0;

        for (let i = 0; i < dedupedTotal; i += BATCH_SIZE) {
          const batch = dedupedRows.slice(i, i + BATCH_SIZE);

          const { error: insertErr } = await supabase
            .from('dsp_campaign_data')
            .insert(batch);

          if (insertErr) {
            send({ type: 'error', message: `Erreur insert batch ${i}: ${insertErr.message}` });
            controller.close();
            return;
          }

          inserted += batch.length;

          if (inserted % (BATCH_SIZE * 4) === 0 || inserted === dedupedTotal) {
            send({
              type: 'progress',
              processed: inserted,
              total: dedupedTotal,
              message: `${inserted}/${dedupedTotal} lignes insérées`,
            });
          }
        }

        // ── IRIS matching (France rows only) ────────────────────────────
        const { count: franceCount } = await supabase
          .from('dsp_campaign_data')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('country', 'France');

        const totalFrance = franceCount ?? 0;

        if (totalFrance > 0) {
          send({
            type: 'matching',
            matched: 0,
            total_france: totalFrance,
            message: `Matching IRIS pour ${totalFrance} lignes France…`,
          });

          const { data: matchResult, error: matchErr } = await supabase
            .rpc('match_campaign_postal_to_iris', { p_campaign_id: campaignId });

          const matched = matchErr ? 0 : ((matchResult as number) ?? 0);

          send({
            type: 'matching',
            matched,
            total_france: totalFrance,
            message: `${matched}/${totalFrance} lignes matchées IRIS`,
          });
        }

        // ── Final count ─────────────────────────────────────────────────
        const { count: matchedCount } = await supabase
          .from('dsp_campaign_data')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .not('code_iris', 'is', null);

        const matched = matchedCount ?? 0;
        const pctMatched = totalFrance > 0 ? Math.round((matched / totalFrance) * 100) : 0;

        send({
          type: 'complete',
          report: {
            campaign_id: campaignId,
            campaign_name: campaignName,
            total_rows: totalRows,
            countries: parsed.countries,
            total_france: totalFrance,
            matched_iris: matched,
            pct_matched: pctMatched,
          },
        });
      } catch (err: unknown) {
        send({
          type: 'error',
          message: `Erreur inattendue : ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
