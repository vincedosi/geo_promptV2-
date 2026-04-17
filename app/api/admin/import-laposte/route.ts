/**
 * POST /api/admin/import-laposte
 *
 * Phase 1: Import La Poste Hexasmal → laposte_hexasmal
 * Phase 2: Build ref_codes_postaux from laposte_hexasmal + ref_communes
 *
 * SSE streaming pour progression.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;
const LAPOSTE_PAGE_SIZE = 10000;

interface LaPosteRow {
  code_commune_insee: string;
  nom_de_la_commune: string;
  code_postal: string;
  libelle_acheminement: string;
  ligne_5: string | null;
  latitude: number | null;
  longitude: number | null;
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const supabase = createAdminClient();

        // ── Phase 1: Fetch La Poste API (paginated JSON) ──────────────────
        send({ phase: 'fetch', message: 'Fetching La Poste data...', progress: 0 });

        const allRows: LaPosteRow[] = [];
        let page = 1;

        while (true) {
          const url = `https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/lines?size=${LAPOSTE_PAGE_SIZE}&page=${page}&format=json`;
          const res = await fetch(url);
          if (!res.ok) {
            send({ phase: 'fetch', error: `HTTP ${res.status} page ${page}` });
            break;
          }

          const data = await res.json();
          const results = data.results ?? data;
          if (!Array.isArray(results) || results.length === 0) break;

          for (const row of results) {
            const cp = (row.code_postal ?? '').toString().trim().padStart(5, '0');
            const cc = (row.code_commune_insee ?? '').toString().trim();
            if (!cp || !cc) continue;

            const lat = parseFloat(row.latitude) || null;
            const lng = parseFloat(row.longitude) || null;

            allRows.push({
              code_commune_insee: cc,
              nom_de_la_commune: (row.nom_de_la_commune ?? '').toString().trim(),
              code_postal: cp,
              libelle_acheminement: (row.libelle_d_acheminement ?? '').toString().trim(),
              ligne_5: (row.ligne_5 ?? '').toString().trim() || null,
              latitude: lat,
              longitude: lng,
            });
          }

          send({ phase: 'fetch', message: `Page ${page} fetched`, rows: allRows.length, progress: Math.min(page * 25, 90) });
          if (results.length < LAPOSTE_PAGE_SIZE) break;
          page++;
        }

        if (allRows.length === 0) {
          send({ phase: 'error', message: 'Aucune donnée La Poste récupérée' });
          controller.close();
          return;
        }

        // Deduplicate on (code_commune_insee, code_postal, ligne_5)
        const deduped = new Map<string, LaPosteRow>();
        for (const row of allRows) {
          const key = `${row.code_commune_insee}|${row.code_postal}|${row.ligne_5 ?? ''}`;
          deduped.set(key, row);
        }
        const unique = Array.from(deduped.values());

        send({ phase: 'fetch', message: `${unique.length} rows uniques (${allRows.length} total)`, progress: 100 });

        // ── Phase 2: Truncate + Insert laposte_hexasmal ──────────────────
        send({ phase: 'insert', message: 'Inserting into laposte_hexasmal...', progress: 0 });

        await supabase.rpc('truncate_laposte_hexasmal' as never);

        let inserted = 0;
        for (let i = 0; i < unique.length; i += BATCH_SIZE) {
          const batch = unique.slice(i, i + BATCH_SIZE);

          const { error } = await supabase.from('laposte_hexasmal').insert(
            batch.map(r => ({
              code_commune_insee: r.code_commune_insee,
              nom_de_la_commune: r.nom_de_la_commune,
              code_postal: r.code_postal,
              libelle_acheminement: r.libelle_acheminement,
              ligne_5: r.ligne_5,
              latitude: r.latitude,
              longitude: r.longitude,
            }))
          );

          if (error) {
            send({ phase: 'insert', error: `Batch ${i}: ${error.message}` });
            // Continue — some batches may fail on unique constraint
          }
          inserted += batch.length;

          if (i % 500 === 0) {
            send({ phase: 'insert', message: `${inserted}/${unique.length}`, progress: Math.round(inserted / unique.length * 100) });
          }
        }

        send({ phase: 'insert', message: `${inserted} rows inserted`, progress: 100 });

        // ── Phase 3: Update centroid geometry ──────────────────────────────
        send({ phase: 'centroid', message: 'Computing centroids...' });

        await supabase.rpc('update_laposte_centroids' as never);

        send({ phase: 'centroid', message: 'Centroids computed', progress: 100 });

        // ── Phase 4: Build ref_codes_postaux ──────────────────────────────
        send({ phase: 'build', message: 'Building ref_codes_postaux...', progress: 0 });

        await supabase.rpc('build_ref_codes_postaux' as never);

        // Verify
        const { data: countData } = await supabase.from('ref_codes_postaux').select('code_postal', { count: 'exact', head: true });
        const cpCount = (countData as unknown as { count: number })?.count ?? 0;

        send({ phase: 'build', message: `ref_codes_postaux built: ${cpCount} codes postaux`, progress: 100 });

        // ── Done ──────────────────────────────────────────────────────────
        send({ phase: 'done', laposte_rows: inserted, ref_cp_count: cpCount });
      } catch (err: unknown) {
        send({ phase: 'error', message: String(err) });
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
