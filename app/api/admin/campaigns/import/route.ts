/**
 * GENESIS — POST /api/admin/campaigns/import
 * Import DSP campaign file (CSV/XLSX) with SSE streaming progress.
 * Parses file, batch-inserts into dsp_campaign_data, triggers IRIS matching.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { parseCampaignFile } from '@/lib/campaigns/parser';
import type { CampaignImportEvent } from '@/types/campaign';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  // ── Parse formData BEFORE creating the stream ─────────────────────
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const dspSource = (formData.get('dsp_source') as string) || 'adform';
  const campaignNameOverride = formData.get('campaign_name') as string | null;

  if (!file) {
    return new Response(JSON.stringify({ error: 'Fichier manquant' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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

        const parsed = parseCampaignFile(buffer, fileName, dspSource);

        if (parsed.errors.length > 0 && parsed.rows.length === 0) {
          send({ type: 'error', message: `Aucune ligne valide. Erreurs : ${parsed.errors.slice(0, 5).join('; ')}` });
          controller.close();
          return;
        }

        const campaignName = campaignNameOverride?.trim() || parsed.campaign_name;
        const totalRows = parsed.rows.length;

        send({
          type: 'progress',
          processed: 0,
          total: totalRows,
          message: `${totalRows} lignes détectées, ${parsed.countries.length} pays`,
        });

        // ── Create campaign record ──────────────────────────────────────
        const supabase = createAdminClient();

        const { data: campaign, error: campErr } = await supabase
          .from('dsp_campaigns')
          .insert({
            name: campaignName,
            dsp_source: dspSource,
            advertiser: null,
            date_start: parsed.date_start,
            date_end: parsed.date_end,
            total_tracked_ads: parsed.total_tracked_ads,
            countries: parsed.countries,
            created_by: profile.id,
          })
          .select('id')
          .single();

        if (campErr || !campaign) {
          send({ type: 'error', message: `Erreur création campagne : ${campErr?.message ?? 'inconnue'}` });
          controller.close();
          return;
        }

        const campaignId = campaign.id;

        // ── Pre-aggregate duplicates (same date+postal_code+city) ────
        const aggMap = new Map<string, {
          campaign_id: string; date: string | null; city: string | null;
          country: string; postal_code: string | null; region: string | null;
          dma_region: string | null; tracked_ads: number;
        }>();

        for (const r of parsed.rows) {
          const key = `${r.date}|${r.postal_code}|${r.city}`;
          const existing = aggMap.get(key);
          if (existing) {
            existing.tracked_ads += r.tracked_ads;
          } else {
            aggMap.set(key, {
              campaign_id: campaignId,
              date: r.date,
              city: r.city,
              country: r.country,
              postal_code: r.postal_code,
              region: r.region,
              dma_region: r.dma_region,
              tracked_ads: r.tracked_ads,
            });
          }
        }

        // Filter out rows with null date (violates NOT NULL constraint)
        const dedupedRows = Array.from(aggMap.values()).filter(r => r.date != null);
        const skippedNoDate = aggMap.size - dedupedRows.length;
        if (skippedNoDate > 0) {
          send({ type: 'progress', processed: 0, total: aggMap.size, message: `${skippedNoDate} lignes sans date ignorées` });
        }
        const dedupedTotal = dedupedRows.length;

        if (dedupedTotal < totalRows) {
          send({
            type: 'progress',
            processed: 0,
            total: dedupedTotal,
            message: `${totalRows - dedupedTotal} doublons agrégés → ${dedupedTotal} lignes uniques`,
          });
        }

        // ── Batch insert rows ───────────────────────────────────────────
        let inserted = 0;

        for (let i = 0; i < dedupedTotal; i += BATCH_SIZE) {
          const batch = dedupedRows.slice(i, i + BATCH_SIZE);

          const { error: insertErr } = await supabase
            .from('dsp_campaign_data')
            .upsert(batch, { onConflict: 'campaign_id,date,postal_code,city' });

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

          const matched = matchErr ? 0 : (matchResult as number) ?? 0;

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
      } catch (err) {
        send({ type: 'error', message: `Erreur inattendue : ${err instanceof Error ? err.message : String(err)}` });
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
