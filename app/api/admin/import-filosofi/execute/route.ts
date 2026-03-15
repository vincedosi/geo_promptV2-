/**
 * POST /api/admin/import-filosofi/execute
 * Importe un fichier .parquet Filosofi dans la table carreaux_filosofi.
 *
 * FormData params:
 *   file       — le fichier .parquet
 *   idcar_col  — nom de la colonne idcar dans le parquet
 *   resolution — '200m' | '1km'
 *   millesime  — ex '2021'
 *
 * Flux retourné : NDJSON (une ligne JSON par événement)
 *   { type:'status',  message: string }
 *   { type:'progress', done: number, total: number, inserted: number, errors: number }
 *   { type:'done',    inserted: number, errors: number, skipped: number }
 *   { type:'error',   message: string }
 */

import { NextRequest } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import proj4 from 'proj4';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 500;

// EPSG:2154 — Lambert 93 (système officiel INSEE)
proj4.defs('EPSG:2154',
  '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

// ─── Décodage idcar → polygone WKT WGS84 ─────────────────────────────────────

/**
 * Décode l'identifiant idcar INSEE Filosofi en polygone WKT WGS84.
 * Format attendu : CARres200mN{northing}E{easting}  (Lambert 93, coin SW)
 *              ou : CARres1kmN{northing}E{easting}
 * Retourne null si le format n'est pas reconnu.
 */
function idcarToWKT(idcar: string, resolution: string): string | null {
  // Pattern : N{northing}E{easting}
  const m = idcar.match(/N(\d+)E(\d+)/);
  if (!m) return null;

  const northing = parseInt(m[1], 10);
  const easting  = parseInt(m[2], 10);
  const size     = resolution === '1km' ? 1000 : 200;

  // 4 coins du carreau en Lambert 93
  const corners: [number, number][] = [
    [easting,        northing],
    [easting + size, northing],
    [easting + size, northing + size],
    [easting,        northing + size],
    [easting,        northing], // fermer le polygone
  ];

  // Reprojection Lambert 93 → WGS84
  try {
    const wgs84Corners = corners.map(([x, y]) => {
      const [lon, lat] = proj4('EPSG:2154', 'WGS84', [x, y]);
      return `${lon.toFixed(8)} ${lat.toFixed(8)}`;
    });
    return `POLYGON((${wgs84Corners.join(', ')}))`;
  } catch {
    return null;
  }
}

// ─── Helper : envoyer un événement NDJSON ────────────────────────────────────
function ndjson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + '\n';
}

// ─── Route ───────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(ndjson(obj)));
      };

      try {
        const form = await request.formData();
        const file       = form.get('file')       as File   | null;
        const idcarCol   = (form.get('idcar_col') as string | null) ?? 'idcar';
        const resolution = (form.get('resolution') as string | null) ?? '200m';
        const millesime  = (form.get('millesime')  as string | null) ?? '2021';

        if (!file) { send({ type: 'error', message: 'Fichier manquant' }); controller.close(); return; }
        if (!file.name.endsWith('.csv')) { send({ type: 'error', message: 'Seuls les fichiers .csv sont acceptés' }); controller.close(); return; }
        if (!/^[0-9]+[a-z]+$/.test(resolution)) { send({ type: 'error', message: 'Résolution invalide' }); controller.close(); return; }
        if (!/^[0-9]{4}$/.test(millesime))       { send({ type: 'error', message: 'Millésime invalide'  }); controller.close(); return; }

        send({ type: 'status', message: `Lecture du fichier (${(file.size / 1024 / 1024).toFixed(1)} Mo)...` });

        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        if (parsed.errors.length > 0) {
          send({ type: 'error', message: parsed.errors[0].message }); controller.close(); return;
        }
        const columns = parsed.meta.fields || [];
        const rowCount = parsed.data.length;
        if (!columns.includes(idcarCol)) {
          send({ type: 'error', message: `Colonne "${idcarCol}" introuvable. Colonnes disponibles : ${columns.join(', ')}` });
          controller.close();
          return;
        }

        send({ type: 'status', message: `${rowCount.toLocaleString('fr-FR')} carreaux détectés — démarrage de l'import...` });

        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const idcarIdx = columns.indexOf(idcarCol);
        const metaCols = columns.filter((_, i) => i !== idcarIdx);

        let totalDone    = 0;
        let totalInserted = 0;
        let totalErrors  = 0;
        let totalSkipped = 0;

        // Lire par chunks de BATCH_SIZE
        const chunkSize = BATCH_SIZE;
        let offset = 0;

        while (offset < rowCount) {
          const rowEnd = Math.min(offset + chunkSize, rowCount);
          const batch: { idcar: string; geom_wkt: string; metadata: Record<string, unknown> }[] = [];

          for (let i = offset; i < rowEnd; i++) {
            const row = parsed.data[i] as Record<string, unknown>;
            const idcar = String(row[idcarCol] ?? '');
            if (!idcar) { totalSkipped++; continue; }
            const wkt = idcarToWKT(idcar, resolution);
            if (!wkt) { totalSkipped++; continue; }
            const metadata: Record<string, unknown> = {};
            metaCols.forEach((col) => {
              const val = row[col];
              if (val !== null && val !== undefined) {
                metadata[col.toLowerCase()] = val;
              }
            });
            batch.push({ idcar, geom_wkt: wkt, metadata });
          }

          if (batch.length > 0) {
            const { error } = await supabase.rpc('import_carreaux_batch', {
              p_idcars:      batch.map(r => r.idcar),
              p_resolutions: batch.map(() => resolution),
              p_millesimes:  batch.map(() => millesime),
              p_geom_wkts:   batch.map(r => r.geom_wkt),
              p_metadatas:   batch.map(r => r.metadata),
            });

            if (error) {
              console.error('[import-filosofi] RPC error:', error.message);
              totalErrors += batch.length;
            } else {
              totalInserted += batch.length;
            }
          }

          totalDone = rowEnd;
          send({
            type: 'progress',
            done: totalDone,
            total: rowCount,
            inserted: totalInserted,
            errors: totalErrors,
            skipped: totalSkipped,
          });

          offset = rowEnd;
          // Yield pour ne pas bloquer la boucle event
          await new Promise(r => setTimeout(r, 0));
        }

        // ── Enregistrement dans data_sources ────────────────────────────
        if (totalInserted > 0) {
          const { error: dsErr } = await supabase
            .from('data_sources')
            .upsert(
              {
                name:              `Filosofi ${millesime} — Carreaux ${resolution}`,
                description:       `Données socio-démographiques INSEE Filosofi ${millesime} (résolution ${resolution}, France métropolitaine) — ${totalInserted.toLocaleString('fr-FR')} carreaux`,
                type:              'carreaux',
                category:          'carreaux',
                original_filename: file.name,
                file_format:       'parquet',
                row_count:         rowCount,
                valid_count:       totalInserted,
                error_count:       totalErrors,
                mapping:           { resolution, millesime, columns },
                geo_config:        { table_name: 'carreaux_filosofi', resolution, millesime },
                status:            'active',
                organization_id:   '00000000-0000-0000-0000-000000000001',
              },
              {
                onConflict:        'name',
                ignoreDuplicates:  false,
              }
            );
          if (dsErr) {
            console.warn('[import-filosofi] data_sources upsert warning:', dsErr.message);
          } else {
            send({ type: 'status', message: `Source enregistrée dans l'onglet Données.` });
          }
        }

        send({
          type: 'done',
          inserted: totalInserted,
          errors:   totalErrors,
          skipped:  totalSkipped,
        });

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        console.error('[import-filosofi/execute]', msg);
        send({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'Cache-Control':     'no-cache',
    },
  });
}
