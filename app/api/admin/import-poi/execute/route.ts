/**
 * GENESIS — API Route — POST /api/admin/import-poi/execute
 * Full import with Server-Sent Events (SSE) progress
 */
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseFile } from '@/lib/import/file-parser';
import { processRows } from '@/lib/import/validator';
import { insertRows, closeConnection } from '@/lib/import/inserter';
import { createAdminClient } from '@/lib/auth';
import type { ImportConfig, GeocodeDetailedResult } from '@/lib/import/types';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const TEMP_DIR = path.join(os.tmpdir(), 'genesis-import');
const GEOCODE_DIR = path.join(os.tmpdir(), 'genesis-geocode');

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
        const config: ImportConfig & { geocodeId?: string } = await request.json();

        // Validate
        if (!config.fileId) {
          send({ type: 'error', message: 'fileId manquant' });
          controller.close();
          return;
        }

        // Find temp file
        const tempFiles = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(config.fileId));
        if (tempFiles.length === 0) {
          send({ type: 'error', message: 'Fichier temporaire introuvable. Re-uploadez le fichier.' });
          controller.close();
          return;
        }

        const tempPath = path.join(TEMP_DIR, tempFiles[0]);
        const buffer = fs.readFileSync(tempPath);
        const fileName = tempFiles[0];

        // Parse file
        send({ type: 'progress', message: 'Parsing du fichier...', processed: 0, total: 0 });
        const parsed = parseFile(buffer, fileName);
        const totalRows = parsed.rows.length;

        send({
          type: 'progress',
          message: `Fichier parse: ${totalRows} lignes detectees`,
          processed: 0,
          total: totalRows,
        });

        // Process rows (mapping + geolocation)
        send({ type: 'progress', message: 'Traitement des coordonnees...', processed: 0, total: totalRows });

        // Load precomputed geocode results if available
        let preGeocodedResults: GeocodeDetailedResult[] | undefined;
        if (config.geocodeId) {
          const geocodePath = path.join(GEOCODE_DIR, `${config.geocodeId}.json`);
          if (fs.existsSync(geocodePath)) {
            const geocodeData = JSON.parse(fs.readFileSync(geocodePath, 'utf-8'));
            preGeocodedResults = geocodeData.results as GeocodeDetailedResult[];
            send({
              type: 'progress',
              message: `Utilisation des coordonnees pre-geocodees (${preGeocodedResults.length} resultats)`,
              processed: 0,
              total: totalRows,
            });
          }
        }

        const result = await processRows(
          parsed.rows,
          config.mapping,
          config.geolocation,
          config.dataType,
          {
            category: config.category,
            regie: config.regie,
            importedColumns: config.importedColumns,
            filterFields: config.filterFields,
            preGeocodedResults,
            onGeoProgress: (processed, total) => {
              send({
                type: 'geocode',
                message: `Geocodage BAN: ${processed}/${total} adresses...`,
                processed,
                total,
              });
            },
          }
        );

        const validCount = result.validRows.length;
        send({
          type: 'progress',
          message: `${validCount} lignes valides, ${result.missingCoords} sans coordonnees`,
          processed: 0,
          total: validCount,
          inserted: 0,
          ignored: 0,
          errors: 0,
        });

        if (validCount === 0) {
          send({
            type: 'complete',
            report: { total: totalRows, inserted: 0, ignored: 0, errors: totalRows },
            message: 'Aucune ligne valide a inserer',
          });
          controller.close();
          return;
        }

        // Create data_source record for tracking
        const orgId = config.organizationId || profile.organization_id;
        let dataSourceId: string | null = null;
        try {
          const supabase = createAdminClient();
          const { data: ds } = await supabase
            .from('data_sources')
            .insert({
              name: config.sourceName || `Import ${config.dataType} — ${new Date().toLocaleDateString('fr-FR')}`,
              type: config.dataType,
              category: config.category || null,
              regie: config.regie || null,
              organization_id: orgId,
              original_filename: fileName,
              file_format: parsed.format,
              row_count: totalRows,
              valid_count: validCount,
              error_count: result.missingCoords + result.invalidCount,
              mapping: config.mapping,
              geo_config: config.geolocation,
              filter_fields: config.filterFields || [],
              status: 'active',
            })
            .select('id')
            .single();
          dataSourceId = ds?.id || null;

          // Tag all valid rows with data_source_id + organization_id
          for (const row of result.validRows) {
            if (dataSourceId) row.data_source_id = dataSourceId;
            row.organization_id = orgId;
          }

          send({ type: 'progress', message: `Source "${ds?.id?.slice(0, 8)}" creee`, processed: 0, total: validCount });
        } catch (dsErr) {
          console.warn('Could not create data_source record:', dsErr);
          // Still tag rows with organization_id even if data_source creation fails
          for (const row of result.validRows) {
            row.organization_id = orgId;
          }
        }

        // Insert into database with progress + live logs
        send({ type: 'log', logLevel: 'info', logLine: `Insertion en base Supabase (${validCount} lignes)...` });

        const insertResult = await insertRows(
          result.validRows,
          config.dataType as "poi" | "panneaux",
          (processed, total, inserted, ignored, errors) => {
            send({
              type: 'progress',
              processed,
              total,
              inserted,
              ignored,
              errors,
            });
          },
          // onLog callback — streame chaque log vers le client en SSE
          (level, message) => {
            send({ type: 'log', logLevel: level, logLine: message });
          }
        );

        // Final report — inclure firstError dans complete pour que le UI l'affiche
        const sqlError = insertResult.firstError || null;
        if (sqlError) {
          console.error('[EXECUTE] ⚠️  ERREUR SQL PREMIERE:', sqlError);
        }
        console.log('[EXECUTE] Rapport final:', {
          total: totalRows,
          inserted: insertResult.inserted,
          ignored: insertResult.ignored + result.missingCoords,
          errors: insertResult.errors,
          firstError: sqlError,
        });

        send({
          type: 'complete',
          report: {
            total: totalRows,
            inserted: insertResult.inserted,
            ignored: insertResult.ignored + result.missingCoords,
            errors: insertResult.errors,
          },
          firstError: sqlError,
        });

        // Clean up temp file
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch { /* ignore */ }

        // Close DB connection
        await closeConnection();

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        console.error('Execute error:', err);
        send({ type: 'error', message });
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
