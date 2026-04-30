import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { createAdminClient } from '@/lib/auth';
import { splitRow, computeDerived } from '@/lib/iris-crawler/storage';
import { CORE_COLUMN_NAMES, classifyTarget } from '@/lib/iris-crawler/db-columns';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import type { UploadSessionData } from '@/app/api/iris-crawler/manual-upload/route';

export const dynamic = 'force-dynamic';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'iris-uploads');
const BATCH_SIZE = 500;
const MAX_RETRIES = 3;

async function retryUpsert<T>(
  fn: () => Promise<{ error: T | null }>,
  retries: number,
  delay: number,
): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await fn();
    if (!error) return null;
    if (attempt < retries) await new Promise(r => setTimeout(r, delay * attempt));
    else return error;
  }
  return null;
}

// POST /api/iris-crawler/manual-import
// Body: { sessionId, irisKeyCol, mapping: Record<csvCol, dbTarget|'ignore'> }
// Réponse: NDJSON streaming
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, message: string, extra?: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(
          JSON.stringify({ type, message, ...extra }) + '\n'
        ));
      };

      let historyId: string | null = null;
      const adminClient = createAdminClient();

      try {
        const body = await req.json() as {
          sessionId?: string;
          irisKeyCol?: string;
          mapping?: Record<string, string>;
        };

        const { sessionId, irisKeyCol, mapping } = body;

        if (!sessionId || !irisKeyCol || !mapping || Object.keys(mapping).length === 0) {
          send('error', 'sessionId, irisKeyCol et mapping requis');
          controller.close();
          return;
        }

        // Charger la session
        let session: UploadSessionData;
        try {
          const raw = await fs.readFile(path.join(UPLOAD_DIR, `${sessionId}.json`), 'utf-8');
          session = JSON.parse(raw) as UploadSessionData;
        } catch {
          send('error', 'Session introuvable ou expirée. Ré-uploadez le fichier.');
          controller.close();
          return;
        }

        send('status', `${session.totalRows} lignes chargées depuis ${session.filename}. Préparation…`);

        // Créer l'entrée historique
        const { data: histEntry } = await adminClient
          .from('iris_import_history')
          .insert({
            filename:      session.filename,
            total_rows:    session.totalRows,
            status:        'processing',
            user_id:       null,
            column_mapping: mapping,
          })
          .select('id')
          .single();

        historyId = histEntry?.id ?? null;

        // ── Découper les lignes en core + JSONB ────────────────────────────────
        const coreRows:      Array<Record<string, string | number | null>> = [];
        const indicatorRows: Array<{ code_iris: string; indicators: Record<string, string | number | null> }> = [];

        for (const row of session.rows) {
          const { coreData, jsonbData, valid } = splitRow(row, irisKeyCol, mapping);
          if (!valid) continue;
          computeDerived(coreData, jsonbData);

          coreRows.push(coreData);

          if (Object.keys(jsonbData).length > 0) {
            indicatorRows.push({
              code_iris:  coreData.code_iris as string,
              indicators: jsonbData,
            });
          }
        }

        const hasIndicators = indicatorRows.length > 0;
        const coreColCount  = Object.values(mapping).filter(v => classifyTarget(v) === 'core').length;
        const jsonbKeyCount = indicatorRows.length > 0 ? Object.keys(indicatorRows[0].indicators).length : 0;
        send('status',
          `${coreRows.length} lignes préparées ` +
          `(${coreColCount} colonnes core` +
          `${hasIndicators ? ` · ${jsonbKeyCount} indicateurs JSONB` : ''})…`
        );

        const totalBatches = Math.ceil(coreRows.length / BATCH_SIZE);
        let totalInserted = 0;
        let totalErrors   = 0;
        const batchErrors: Array<{ batch: number; message: string }> = [];

        for (let i = 0; i < coreRows.length; i += BATCH_SIZE) {
          const coreBatch = coreRows.slice(i, i + BATCH_SIZE);
          const batchNum  = Math.floor(i / BATCH_SIZE) + 1;

          // ── 1. Update colonnes core (UPDATE uniquement — pas d'INSERT, évite NOT NULL) ──
          const coreError = await retryUpsert(
            async () => adminClient.rpc('update_iris_core_batch', { p_rows: coreBatch }),
            MAX_RETRIES,
            500,
          );

          if (coreError) {
            const msg = (coreError as { message?: string }).message ?? String(coreError);
            send('status', `! Batch ${batchNum}/${totalBatches} core erreur : ${msg}`);
            batchErrors.push({ batch: batchNum, message: msg });
            totalErrors += coreBatch.length;
          } else {
            totalInserted += coreBatch.length;
          }

          // ── 2. Merge JSONB indicators ────────────────────────────────────────
          if (hasIndicators) {
            const indBatch = indicatorRows.slice(i, i + BATCH_SIZE);
            if (indBatch.length > 0) {
              const { error: rpcError } = await adminClient.rpc(
                'merge_iris_indicators_batch',
                { p_rows: indBatch },  // pas de JSON.stringify — le client Supabase sérialise automatiquement
              );
              if (rpcError) {
                send('status', `⚠ Batch ${batchNum} indicators : ${rpcError.message}`);
              }
            }
          }

          const pct = Math.round(((i + coreBatch.length) / coreRows.length) * 100);
          send('progress', `Batch ${batchNum}/${totalBatches} — ${pct}%`, {
            percent:       pct,
            totalInserted,
            totalErrors,
          });
        }

        // ── 3. Registre des indicateurs ──────────────────────────────────────
        if (hasIndicators) {
          const sampleRow   = indicatorRows[0];
          const registryRows = Object.keys(sampleRow.indicators).map(key => ({
            key,
            dataset:     session.filename.replace(/\.[^.]+$/, ''),
            label:       key,
            type:        'numeric',
            imported_at: new Date().toISOString(),
            sample_values: indicatorRows
              .slice(0, 3)
              .map(r => ({ [r.code_iris]: r.indicators[key] }))
              .reduce((a, b) => ({ ...a, ...b }), {}),
          }));

          await adminClient
            .from('iris_indicator_registry')
            .upsert(registryRows, { onConflict: 'key', ignoreDuplicates: false });
        }

        // ── 4. Statut final + historique ─────────────────────────────────────
        const finalStatus = totalErrors === 0 ? 'success'
          : totalInserted > 0 ? 'partial' : 'error';

        if (historyId) {
          await adminClient
            .from('iris_import_history')
            .update({
              inserted_rows: totalInserted,
              updated_rows:  totalInserted,
              error_rows:    totalErrors,
              status:        finalStatus,
              error_details: batchErrors.length > 0 ? batchErrors : null,
            })
            .eq('id', historyId);
        }

        // Nettoyer la session temp
        try { await fs.unlink(path.join(UPLOAD_DIR, `${sessionId}.json`)); } catch { /* ignore */ }

        const mappedCols = Object.values(mapping).filter(v => v !== 'ignore');
        send('done',
          `✓ ${totalInserted} IRIS mis à jour` +
          (hasIndicators ? ` + ${Object.keys(indicatorRows[0]?.indicators ?? {}).length} indicateurs JSONB` : ''),
          { totalInserted, totalErrors, status: finalStatus, historyId, columns: mappedCols }
        );

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (historyId) {
          try {
            await adminClient
              .from('iris_import_history')
              .update({ status: 'error', error_details: [{ message: msg }] })
              .eq('id', historyId);
          } catch { /* ignore */ }
        }
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
      'Content-Type':     'application/x-ndjson',
      'Cache-Control':    'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
