import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { loadBase, splitRow, computeDerived } from '@/lib/iris-crawler/storage';
import { classifyTarget } from '@/lib/iris-crawler/db-columns';

export const dynamic = 'force-dynamic';

// POST /api/iris-crawler/upload
// Body: {
//   catalogId: string,
//   irisKeyCol: string,
//   mapping: Record<csvCol, dbTarget>  // dbTarget = core col | JSONB key | 'ignore'
// }
export async function POST(req: NextRequest) {
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

        // Charger le JSON téléchargé
        send('status', `Chargement de ${catalogId}…`);
        const base = await loadBase(catalogId);
        if (!base) {
          send('error', `Base ${catalogId} non trouvée — téléchargez-la d'abord`);
          controller.close();
          return;
        }

        const { rows } = base;
        const coreColCount = Object.values(mapping).filter(v => classifyTarget(v) === 'core').length;
        const jsonbColCount = Object.values(mapping).filter(v => classifyTarget(v) === 'jsonb').length;
        send('status', `${rows.length} lignes · ${coreColCount} core · ${jsonbColCount} JSONB. Préparation…`);

        // ── [DIAG] Traces temporaires ─────────────────────────────────────────
        console.log('[DIAG] COLONNES CSV:', Object.keys(rows[0] ?? {}));
        console.log('[DIAG] LIGNE 1:', JSON.stringify(rows[0]));
        const empltCols = Object.keys(rows[0] ?? {}).filter(k => /EMPLT|ACTOCC|ACT1564/i.test(k));
        console.log('[DIAG] Colonnes emploi détectées:', empltCols);
        const mappingEmploi: Record<string, string> = {};
        for (const col of empltCols) { if (mapping[col]) mappingEmploi[col] = mapping[col]; }
        console.log('[DIAG] MAPPING colonnes emploi:', JSON.stringify(mappingEmploi));
        const mappingCore = Object.entries(mapping).filter(([, v]) => classifyTarget(v) === 'core');
        console.log('[DIAG] MAPPING core complet:', JSON.stringify(Object.fromEntries(mappingCore)));
        // ─────────────────────────────────────────────────────────────────────

        // Découper les lignes en core + JSONB
        const coreRows:      Array<Record<string, string | number | null>> = [];
        const indicatorRows: Array<{ code_iris: string; indicators: Record<string, string | number | null> }> = [];

        for (const row of rows) {
          const r = row as Record<string, string>;
          const { coreData, jsonbData, valid } = splitRow(r, irisKeyCol, mapping);
          if (!valid) continue;
          computeDerived(coreData, jsonbData);

          coreRows.push(coreData);
          if (Object.keys(jsonbData).length > 0) {
            indicatorRows.push({ code_iris: coreData.code_iris as string, indicators: jsonbData });
          }
        }

        // ── [DIAG] Inspecter la première ligne après splitRow + computeDerived ─
        if (coreRows.length > 0) {
          console.log('[DIAG] UPSERT KEYS (coreRows[0]):', Object.keys(coreRows[0]));
          console.log('[DIAG] SAMPLE coreRows[0]:', JSON.stringify(coreRows[0]));
          console.log('[DIAG] nb_emplois:', coreRows[0]['nb_emplois'], '| taux_emploi:', coreRows[0]['taux_emploi']);
          console.log('[DIAG] taux_chomage:', coreRows[0]['taux_chomage']);
        }
        // ─────────────────────────────────────────────────────────────────────

        send('status', `${coreRows.length} lignes préparées. Envoi vers Supabase…`);

        const adminClient = createAdminClient();
        const BATCH = 500;
        let totalUpdated = 0;
        const totalBatches = Math.ceil(coreRows.length / BATCH);
        const hasIndicators = indicatorRows.length > 0;

        for (let i = 0; i < coreRows.length; i += BATCH) {
          const coreBatch = coreRows.slice(i, i + BATCH);
          const batchNum  = Math.floor(i / BATCH) + 1;

          // 1. Update colonnes core (UPDATE uniquement — pas d'INSERT, évite NOT NULL)
          const { error } = await adminClient.rpc(
            'update_iris_core_batch',
            { p_rows: coreBatch },
          );

          if (error) {
            send('error', `Erreur batch ${batchNum}/${totalBatches} : ${error.message}`);
            controller.close();
            return;
          }

          // 2. Merge JSONB indicators
          if (hasIndicators) {
            const indBatch = indicatorRows.slice(i, i + BATCH);
            if (indBatch.length > 0) {
              const { error: rpcErr } = await adminClient.rpc(
                'merge_iris_indicators_batch',
                { p_rows: indBatch },
              );
              if (rpcErr) {
                send('status', `⚠ Batch ${batchNum} indicators : ${rpcErr.message}`);
              }
            }
          }

          totalUpdated += coreBatch.length;
          const pct = Math.round((totalUpdated / coreRows.length) * 100);
          send('progress', `Batch ${batchNum}/${totalBatches} — ${pct}%`, {
            percent: pct,
            totalUpdated,
          });
        }

        const mappedCols = Object.values(mapping).filter(v => v !== 'ignore');
        send('done',
          `✓ ${totalUpdated} IRIS mis à jour — ${mappedCols.join(', ')}`,
          { totalUpdated, columns: mappedCols }
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
      'Content-Type':      'application/x-ndjson',
      'Cache-Control':     'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
