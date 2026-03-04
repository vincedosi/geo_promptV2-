/**
 * GENESIS — POST /api/integration-panneaux/execute
 * Execute panneaux import with Server-Sent Events progress streaming
 *
 * Body: {
 *   fileId: string,
 *   regie: string,        // static regie name (e.g. "Clear Channel")
 *   mapping: FieldMapping (reference_panneau, type_panneau, ville, code_postal, departement, region),
 *   geolocation: { mode: 'gps'|'lambert93', colLat?, colLng?, colX?, colY? },
 *   limit?: number,
 * }
 */
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseFile } from '@/lib/import/file-parser';
import { processRows } from '@/lib/import/validator';
import { insertRows } from '@/lib/import/inserter';
import { reverseGeocodeRows } from '@/lib/import/geocoder';
import { requireAdmin } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import type { FieldMapping, GeoConfig } from '@/lib/import/types';

// Extend timeout for large imports (Vercel Pro = 300s, Hobby = 60s)
export const maxDuration = 300;

const TEMP_DIR = path.join(os.tmpdir(), 'genesis-panneaux');

export async function POST(request: NextRequest) {
  console.log('[execute] ▶ POST reçu');

  const profile = await requireAdmin(request);
  console.log('[execute] profile:', profile ? profile.email : 'null (non autorisé)');
  if (!profile) return new Response('Unauthorized', { status: 401 });

  // ── Parse request body BEFORE creating the stream ──────────
  const rawBody: any = await request.json().catch((e: unknown) => {
    console.error('[execute] request.json() échec:', e);
    return null;
  });
  if (!rawBody) {
    return new Response(JSON.stringify({ error: 'Corps de requête JSON invalide' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fileId: string            = rawBody.fileId ?? '';
  console.log('[execute] fileId:', fileId, '| mode:', rawBody.geolocation?.mode);
  const regie: string             = rawBody.regie ?? 'Inconnu';
  const enrichDeptRegion: boolean = rawBody.enrichDeptRegion ?? true;
  const rawMapping: Record<string, string | undefined> = rawBody.mapping ?? {};
  const rawGeo: { mode: string; colLat?: string; colLng?: string; colX?: string; colY?: string } =
    rawBody.geolocation ?? { mode: 'gps' };
  const limit: number | undefined = rawBody.limit;
  const fileName: string          = rawBody.fileName ?? 'fichier_panneaux';
  const fileFormat: string        = rawBody.fileFormat ?? 'unknown';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      // Send immediately so the client knows the stream is alive
      console.log('[execute] stream start() — envoi heartbeat');
      send({ type: 'log', logLevel: 'info', logLine: '✔ Connexion serveur établie' });

      try {

        if (!fileId) {
          send({ type: 'error', message: 'fileId manquant' });
          return; // finally will close the controller
        }

        // ── Locate temp file ──────────────────────────────────
        const tempFiles = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));
        if (tempFiles.length === 0) {
          send({ type: 'error', message: 'Fichier temporaire introuvable — re-uploadez le fichier.' });
          return; // finally will close the controller
        }

        const tempPath = path.join(TEMP_DIR, tempFiles[0]);
        const isShapefileJson = tempFiles[0].endsWith('.shp.json');

        // ── Parse file ────────────────────────────────────────
        send({ type: 'log', logLevel: 'info', logLine: 'Lecture du fichier…' });

        let rows: Record<string, string | null>[];

        if (isShapefileJson) {
          rows = JSON.parse(fs.readFileSync(tempPath, 'utf-8'));
        } else {
          const buffer = fs.readFileSync(tempPath);
          const parsed = parseFile(buffer, tempFiles[0]);
          rows = parsed.rows;
        }

        const totalRows = limit ? Math.min(limit, rows.length) : rows.length;
        const limitedRows = rows.slice(0, totalRows);
        send({ type: 'log', logLevel: 'info', logLine: `${totalRows} lignes à traiter` });

        // ── Build typed config ────────────────────────────────
        const mapping: FieldMapping = {
          nom:               rawMapping.nom               || undefined,
          adresse:           rawMapping.adresse           || undefined,
          ville:             rawMapping.ville             || undefined,
          code_postal:       rawMapping.code_postal       || undefined,
          departement:       rawMapping.departement       || undefined,
          region:            rawMapping.region            || undefined,
          reference_panneau: rawMapping.reference_panneau || undefined,
          type_panneau:      rawMapping.type_panneau      || undefined,
        };

        const geolocation: GeoConfig = {
          mode: rawGeo.mode as 'gps' | 'lambert93',
          colLat: rawGeo.colLat,
          colLng: rawGeo.colLng,
          colX:   rawGeo.colX,
          colY:   rawGeo.colY,
        };

        // ── Process rows (validate + geolocate) ──────────────
        send({ type: 'log', logLevel: 'info', logLine: 'Traitement des coordonnées…' });

        const processed = await processRows(limitedRows, mapping, geolocation, 'panneaux', {
          regie: regie || 'Inconnu',
          onGeoProgress: (done, total) => {
            send({ type: 'geocode', processed: done, total, message: `Coordonnées: ${done}/${total}` });
          },
        });

        send({
          type: 'log',
          logLevel: 'info',
          logLine: `Résumé: ${processed.validRows.length} valides / ${processed.missingCoords} sans coords / ${processed.invalidCount} erreurs`,
        });

        if (processed.validRows.length === 0) {
          send({ type: 'error', message: 'Aucune ligne valide avec coordonnées. Vérifiez le mapping.' });
          return; // finally will close the controller
        }

        // ── Enrichissement département / région via BAN reverse ─
        if (enrichDeptRegion) {
          const toEnrich = processed.validRows
            .map((r, i) => ({ index: i, r }))
            .filter(({ r }) => (!r.departement || !r.region) && r.lat && r.lng)
            .map(({ index, r }) => ({ index, lat: r.lat, lng: r.lng }));

          if (toEnrich.length > 0) {
            send({
              type: 'log', logLevel: 'info',
              logLine: `Enrichissement dept/région via BAN reverse pour ${toEnrich.length} ligne(s)…`,
            });

            const reversed = await reverseGeocodeRows(toEnrich, (done, total) => {
              send({ type: 'geocode', processed: done, total, message: `Reverse geocoding: ${done}/${total}` });
            });

            let enriched = 0;
            for (const rev of reversed) {
              const row = processed.validRows[rev.index];
              if (!row) continue;
              if (!row.departement && rev.dept_nom) {
                row.departement = rev.dept_nom;
                row.code_departement = rev.dept_code;
                enriched++;
              }
              if (!row.region && rev.region) row.region = rev.region;
              if (!row.ville && rev.ville) row.ville = rev.ville;
              if (!row.code_postal && rev.code_postal) row.code_postal = rev.code_postal;
            }

            send({
              type: 'log', logLevel: 'info',
              logLine: `Département/région enrichi pour ${enriched} ligne(s)`,
            });
          }
        }

        // ── Insert into Supabase ──────────────────────────────
        send({ type: 'log', logLevel: 'info', logLine: 'Insertion en base Supabase…' });

        const report = await insertRows(
          processed.validRows,
          'panneaux',
          (done, total, inserted, ignored, errors) => {
            send({ type: 'progress', processed: done, total, inserted, ignored, errors });
          },
          (level, line) => {
            send({ type: 'log', logLevel: level, logLine: line });
          }
        );

        // ── Créer entrée data_sources ──────────────────────────
        try {
          const supabase = createAdminClient();
          const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const { error: srcErr } = await supabase.from('data_sources').insert({
            name: `OOH — ${regie} — ${dateStr}`,
            type: 'panneaux',
            regie: regie || 'Inconnu',
            original_filename: fileName,
            file_format: fileFormat,
            row_count: totalRows,
            valid_count: report.inserted + report.ignored,
            error_count: report.errors,
            mapping: rawMapping,
            geo_config: rawGeo,
            imported_by: profile.email,
            organization_id: profile.organization_id || '00000000-0000-0000-0000-000000000001',
            status: 'active',
          });
          if (srcErr) console.warn('[execute] data_sources insert échoué:', srcErr.message);
          else send({ type: 'log', logLevel: 'info', logLine: 'Source enregistrée dans le catalogue.' });
        } catch (srcEx) {
          console.warn('[execute] data_sources insert exception (non-bloquant):', srcEx);
        }

        send({
          type: 'complete',
          report,
          message: `Import terminé : ${report.inserted} insérés, ${report.ignored} doublons, ${report.errors} erreurs`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[integration-panneaux/execute]', err);
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
