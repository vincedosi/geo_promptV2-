import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { parseInseeValue, classifyColumns } from '@/lib/iris-crawler/parser';
import { saveBase } from '@/lib/iris-crawler/storage';
import { getCatalogEntry } from '@/lib/iris-crawler/catalog';
import type { DownloadedBase, DownloadStreamEvent } from '@/lib/iris-crawler/types';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';
// Pas de maxDuration en dev local — laisser tourner le temps nécessaire

// Whitelist SSRF : seuls ces domaines sont autorisés pour le téléchargement
const ALLOWED_CSV_DOMAINS = [
  'www.insee.fr',
  'static.data.gouv.fr',
  'data.gouv.fr',
  'insee.fr',
  'files.data.gouv.fr',
];

// POST /api/iris-crawler/download
// Body: { catalogId: string, csvUrl: string }
export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: DownloadStreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        const body = await req.json() as { catalogId?: string; csvUrl?: string };
        const { catalogId, csvUrl } = body;

        if (!catalogId || !csvUrl) {
          send({ type: 'error', message: 'catalogId et csvUrl requis' });
          controller.close();
          return;
        }

        // ── Validation URL (anti-SSRF) ────────────────────────────────────────
        let csvUrlObj: URL;
        try {
          csvUrlObj = new URL(csvUrl);
        } catch {
          send({ type: 'error', message: 'URL invalide' });
          controller.close();
          return;
        }

        if (csvUrlObj.protocol !== 'https:' || !ALLOWED_CSV_DOMAINS.includes(csvUrlObj.hostname)) {
          send({ type: 'error', message: 'Domaine non autorisé. Seuls les domaines INSEE/data.gouv.fr sont acceptés.' });
          controller.close();
          return;
        }

        const h = csvUrlObj.hostname;
        if (h === 'localhost' || h === '[::1]' ||
            h.startsWith('127.') || h.startsWith('169.254.') ||
            h.startsWith('10.') || h.startsWith('192.168.')) {
          send({ type: 'error', message: 'Adresse non autorisée' });
          controller.close();
          return;
        }

        const entry = getCatalogEntry(catalogId);
        if (!entry) {
          send({ type: 'error', message: `Catalogue inconnu : ${catalogId}` });
          controller.close();
          return;
        }

        // ── 1. Télécharger le ZIP ─────────────────────────────────────────────
        send({ type: 'status', message: `Téléchargement de ${csvUrl.split('/').pop()}…` });

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 180_000);

        let zipBuffer: ArrayBuffer;
        try {
          const res = await fetch(csvUrl, {
            headers: {
              'User-Agent': 'GENESIS/1.0 (geo.prompt data crawler)',
              'Accept': '*/*',
            },
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            send({ type: 'error', message: `HTTP ${res.status} pour ${csvUrl}` });
            controller.close();
            return;
          }
          zipBuffer = await res.arrayBuffer();
        } catch (e) {
          clearTimeout(timer);
          send({ type: 'error', message: `Erreur téléchargement : ${e instanceof Error ? e.message : String(e)}` });
          controller.close();
          return;
        }

        const fileSizeBytes = zipBuffer.byteLength;
        const urlLower = csvUrl.toLowerCase();
        const isDirectCsv = urlLower.endsWith('.csv') || urlLower.includes('.csv?');

        // ── 2. Extraire le ZIP ou lire le CSV direct ──────────────────────────
        let csvContent = '';
        let csvFileName = '';

        if (isDirectCsv) {
          // CSV direct — pas de ZIP
          csvFileName = csvUrl.split('/').pop()?.split('?')[0] ?? 'data.csv';
          send({ type: 'status', message: `CSV direct (${(fileSizeBytes / 1024 / 1024).toFixed(1)} Mo). Lecture…` });
          try {
            csvContent = new TextDecoder('utf-8').decode(zipBuffer);
          } catch (e) {
            send({ type: 'error', message: `Erreur lecture CSV : ${e instanceof Error ? e.message : String(e)}` });
            controller.close();
            return;
          }
        } else {
          // ZIP — extraction
          send({ type: 'status', message: `ZIP téléchargé (${(fileSizeBytes / 1024 / 1024).toFixed(1)} Mo). Extraction…` });
          try {
            const zip = await JSZip.loadAsync(zipBuffer);

            const csvEntries: Array<{ name: string; file: JSZip.JSZipObject }> = [];
            zip.forEach((relativePath, file) => {
              if (!file.dir && relativePath.toLowerCase().endsWith('.csv')) {
                const basename = relativePath.split('/').pop() ?? relativePath;
                if (!basename.toLowerCase().startsWith('meta_')) {
                  csvEntries.push({ name: relativePath, file });
                }
              }
            });

            if (csvEntries.length === 0) {
              send({ type: 'error', message: 'Aucun fichier CSV trouvé dans le ZIP' });
              controller.close();
              return;
            }

            const chosen = csvEntries.find(e => {
              const n = e.name.toLowerCase();
              return n.includes('base-ic') || n.includes('base_td') || n.includes('base_ic');
            }) ?? csvEntries[0];

            csvFileName = chosen.name.split('/').pop() ?? chosen.name;
            send({ type: 'status', message: `Extraction de ${csvFileName}…` });
            csvContent = await chosen.file.async('string');
          } catch (e) {
            send({ type: 'error', message: `Erreur extraction ZIP : ${e instanceof Error ? e.message : String(e)}` });
            controller.close();
            return;
          }
        }

        // ── 3. Parser le CSV ──────────────────────────────────────────────────
        send({ type: 'status', message: `Parsing CSV (${(csvContent.length / 1024 / 1024).toFixed(1)} Mo)…` });

        let headers: string[] = [];
        let rawRows: Record<string, string>[] = [];

        try {
          const result = Papa.parse<Record<string, string>>(csvContent, {
            header: true,
            delimiter: ';',
            skipEmptyLines: true,
          });

          if (result.errors.length > 0) {
            const fatals = result.errors.filter(e => e.type === 'Delimiter' || e.type === 'Quotes');
            if (fatals.length > 0) {
              send({ type: 'error', message: `Erreur parsing CSV : ${fatals[0].message}` });
              controller.close();
              return;
            }
          }

          headers = result.meta.fields ?? [];
          rawRows = result.data;
        } catch (e) {
          send({ type: 'error', message: `Erreur parsing CSV : ${e instanceof Error ? e.message : String(e)}` });
          controller.close();
          return;
        }

        send({ type: 'status', message: `${rawRows.length} lignes × ${headers.length} colonnes. Conversion des types…` });

        // ── 4. Convertir les types ────────────────────────────────────────────
        const { geoColumns, dataColumns } = classifyColumns(headers);

        const rows: Array<Record<string, string | number | null>> = rawRows.map(raw => {
          const row: Record<string, string | number | null> = {};
          for (const col of headers) {
            row[col] = parseInseeValue(raw[col] ?? '', col);
          }
          return row;
        });

        // ── 5. Sauvegarder ────────────────────────────────────────────────────
        send({ type: 'status', message: 'Sauvegarde…' });

        const downloadedBase: DownloadedBase = {
          catalogId,
          downloadedAt: new Date().toISOString(),
          csvFileName,
          headers,
          geoColumns,
          dataColumns,
          rowCount: rows.length,
          fileSizeBytes,
          rows,
        };

        await saveBase(downloadedBase);

        send({
          type: 'done',
          message: `✓ ${rows.length} lignes, ${headers.length} colonnes — ${csvFileName}`,
          rowCount: rows.length,
          columnCount: headers.length,
          csvFileName,
        });

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(
          JSON.stringify({ type: 'error', message: `Erreur inattendue : ${msg}` } satisfies DownloadStreamEvent) + '\n'
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
