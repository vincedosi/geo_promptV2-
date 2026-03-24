import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { loadBase } from '@/lib/iris-crawler/storage';
import { IRIS_DB_COLUMN_NAMES } from '@/lib/iris-crawler/db-columns';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

// POST /api/iris-crawler/upload
// Body: {
//   catalogId: string,
//   irisKeyCol: string,            // colonne CSV contenant le code IRIS (ex: "IRIS")
//   mapping: Record<string,string> // csvCol → irisTableCol
// }
export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, message: string, extra?: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(
          JSON.stringify({ type, message, ...extra }) + '\n'
        ));
      };

      try {
        const body = await req.json() as {
          catalogId?: string;
          irisKeyCol?: string;
          mapping?: Record<string, string>;
        };

        const { catalogId, irisKeyCol, mapping } = body;

        if (!catalogId || !irisKeyCol || !mapping || Object.keys(mapping).length === 0) {
          send('error', 'catalogId, irisKeyCol et mapping requis');
          controller.close();
          return;
        }

        // Vérifier que les colonnes cibles sont valides
        const invalidCols = Object.values(mapping).filter(c => !IRIS_DB_COLUMN_NAMES.has(c));
        if (invalidCols.length > 0) {
          send('error', `Colonnes DB inconnues : ${invalidCols.join(', ')}`);
          controller.close();
          return;
        }

        // ── Charger le JSON téléchargé ────────────────────────────────────────
        send('status', `Chargement de ${catalogId}…`);
        const base = await loadBase(catalogId);
        if (!base) {
          send('error', `Base ${catalogId} non trouvée — téléchargez-la d'abord`);
          controller.close();
          return;
        }

        const { rows } = base;
        send('status', `${rows.length} lignes chargées. Préparation…`);

        // ── Préparer les lignes pour l'upsert ─────────────────────────────────
        const csvCols = Object.keys(mapping);
        const prepared: Array<Record<string, string | number | null>> = [];

        for (const row of rows) {
          const irisCode = row[irisKeyCol];
          if (!irisCode || typeof irisCode !== 'string') continue;

          const record: Record<string, string | number | null> = {
            code_iris: irisCode,
          };

          for (const csvCol of csvCols) {
            const dbCol = mapping[csvCol];
            const val = row[csvCol];
            record[dbCol] = val ?? null;
          }

          prepared.push(record);
        }

        send('status', `${prepared.length} lignes à upserter. Envoi vers Supabase…`);

        // ── Batch upsert (500 lignes à la fois) ───────────────────────────────
        const adminClient = createAdminClient();
        const BATCH = 500;
        let totalUpdated = 0;
        const totalBatches = Math.ceil(prepared.length / BATCH);

        for (let i = 0; i < prepared.length; i += BATCH) {
          const batch = prepared.slice(i, i + BATCH);
          const batchNum = Math.floor(i / BATCH) + 1;

          const { error } = await adminClient
            .from('iris')
            .upsert(batch, { onConflict: 'code_iris', ignoreDuplicates: false });

          if (error) {
            send('error', `Erreur batch ${batchNum}/${totalBatches} : ${error.message}`);
            controller.close();
            return;
          }

          totalUpdated += batch.length;
          const pct = Math.round((totalUpdated / prepared.length) * 100);
          send('progress', `Batch ${batchNum}/${totalBatches} — ${pct}%`, {
            percent: pct,
            totalUpdated,
          });
        }

        send('done',
          `✓ ${totalUpdated} IRIS mis à jour — ${Object.values(mapping).join(', ')}`,
          { totalUpdated, columns: Object.values(mapping) }
        );

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(
          JSON.stringify({ type: 'error', message: `Erreur inattendue : ${msg}` }) + '\n'
        ));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
