/**
 * POST /api/iris-import/insee
 * Télécharge les fichiers INSEE IRIS, parse et upsert dans la table iris.
 * Body : { sources: ('pop'|'men'|'dip'|'log'|'act')[], year: string, dept?: string, dryRun?: boolean }
 * Réponse : NDJSON streaming
 *   { type: 'log',          source?, message }
 *   { type: 'source_done', source, count }
 *   { type: 'progress',    done, total }
 *   { type: 'done',        total, dryRun }
 *   { type: 'error',       source?, message }
 */

import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — fichiers INSEE volumineux

const BATCH = 500;

// ── URLs INSEE par millésime ──────────────────────────────────────────────────
const INSEE_URLS: Record<string, Record<string, string>> = {
  '2022': {
    pop: 'https://www.insee.fr/fr/statistiques/fichier/8647014/base-ic-evol-struct-pop-2022_csv.zip',
    men: 'https://www.insee.fr/fr/statistiques/fichier/8647008/base-ic-couples-familles-menages-2022_csv.zip',
    dip: 'https://www.insee.fr/fr/statistiques/fichier/8647010/base-ic-diplomes-formation-2022_csv.zip',
    log: 'https://www.insee.fr/fr/statistiques/fichier/8647012/base-ic-logement-2022_csv.zip',
    act: 'https://www.insee.fr/fr/statistiques/fichier/8647006/base-ic-activite-residents-2022_csv.zip',
  },
  '2021': {
    pop: 'https://www.insee.fr/fr/statistiques/fichier/8268806/base-ic-evol-struct-pop-2021_csv.zip',
    men: 'https://www.insee.fr/fr/statistiques/fichier/8268828/base-ic-couples-familles-menages-2021_csv.zip',
    dip: 'https://www.insee.fr/fr/statistiques/fichier/8268840/base-ic-diplomes-formation-2021_csv.zip',
    log: 'https://www.insee.fr/fr/statistiques/fichier/8268838/base-ic-logement-2021_csv.zip',
    act: 'https://www.insee.fr/fr/statistiques/fichier/8268843/base-ic-activite-residents-2021_csv.zip',
  },
  '2020': {
    pop: 'https://www.insee.fr/fr/statistiques/fichier/7704076/base-ic-evol-struct-pop-2020_csv.zip',
    men: 'https://www.insee.fr/fr/statistiques/fichier/7704086/base-ic-couples-familles-menages-2020_csv.zip',
    dip: 'https://www.insee.fr/fr/statistiques/fichier/7704080/base-ic-diplomes-formation-2020_csv.zip',
    log: 'https://www.insee.fr/fr/statistiques/fichier/7704078/base-ic-logement-2020_csv.zip',
    act: 'https://www.insee.fr/fr/statistiques/fichier/7704089/base-ic-activite-residents-2020_csv.zip',
  },
};

const SOURCE_LABELS: Record<string, string> = {
  pop: 'Population & tranches d\'âge & CSP',
  men: 'Ménages',
  dip: 'Diplômes & formation',
  log: 'Logement · propriétaires',
  act: 'Activité · chômage',
};

// ── ZIP extraction (JSZip — supporte data descriptors, ZIP64, etc.) ──────────
async function extractCsvFromZip(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const csvPaths: string[] = [];
  zip.forEach(relativePath => {
    const basename = relativePath.split('/').pop() ?? relativePath;
    if (relativePath.toLowerCase().endsWith('.csv') && !basename.toLowerCase().startsWith('meta_')) {
      csvPaths.push(relativePath);
    }
  });
  if (csvPaths.length === 0) throw new Error('Aucun fichier CSV trouvé dans le ZIP');
  const chosen = csvPaths.find(p => {
    const n = p.toLowerCase();
    return n.includes('base-ic') || n.includes('base_ic') || n.includes('base_td');
  }) ?? csvPaths[0];
  return await zip.file(chosen)!.async('nodebuffer');
}

// ── CSV parsing (latin-1, séparateur ;) ──────────────────────────────────────
function parseCsv(buffer: Buffer): Record<string, string>[] {
  const text    = new TextDecoder('iso-8859-1').decode(buffer);
  const lines   = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols: string[] = line.split(';');
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = (cols[j] ?? '').trim().replace(/^"|"$/g, ''); });
    rows.push(row);
  }
  return rows;
}

// ── Type helpers ──────────────────────────────────────────────────────────────
function safeInt(val: string): number | null {
  const v = (val ?? '').trim().replace(',', '.');
  if (!v || ['s', 'ns', 'NS', 'nd', 'ND'].includes(v)) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : Math.round(n);
}

function safeFloat(val: string): number | null {
  const v = (val ?? '').trim().replace(',', '.');
  if (!v || ['s', 'ns', 'NS', 'nd', 'ND'].includes(v)) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function irisCode(row: Record<string, string>): string {
  return (row['IRIS'] ?? row['iris'] ?? '').trim();
}

// ── Extracteurs par source ────────────────────────────────────────────────────
function buildPop(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const p = `P${y}_`;
  const c = `C${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code = irisCode(row);
    if (code.length < 9) continue;
    out[code] = {
      population:      safeInt(row[`${p}POP`]    ?? ''),
      pop_0_14:        safeInt(row[`${p}POP0014`] ?? ''),
      pop_15_29:       safeInt(row[`${p}POP1529`] ?? ''),
      pop_30_44:       safeInt(row[`${p}POP3044`] ?? ''),
      pop_45_59:       safeInt(row[`${p}POP4559`] ?? ''),
      pop_60_74:       safeInt(row[`${p}POP6074`] ?? ''),
      pop_75_plus:     safeInt(row[`${p}POP75P`]  ?? ''),
      nb_csp_cadre:    safeInt(row[`${c}POP15P_CS3`] ?? ''),
      nb_csp_employe:  safeInt(row[`${c}POP15P_CS5`] ?? ''),
      nb_csp_ouvrier:  safeInt(row[`${c}POP15P_CS6`] ?? ''),
    };
  }
  return out;
}

function buildMen(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const c = `C${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code = irisCode(row);
    if (code.length < 9) continue;
    const nb = safeInt(row[`${c}MEN`] ?? '');
    if (nb !== null) out[code] = { nb_menages: nb };
  }
  return out;
}

function buildDip(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const p = `P${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code = irisCode(row);
    if (code.length < 9) continue;
    const aucun = safeInt(row[`${p}NSCOL15P_DIPLMIN`] ?? '');
    const bac   = safeInt(row[`${p}NSCOL15P_BAC`]    ?? '');
    const sup2  = safeInt(row[`${p}NSCOL15P_SUP2`]   ?? '') ?? 0;
    const sup34 = safeInt(row[`${p}NSCOL15P_SUP34`]  ?? '') ?? 0;
    const sup5  = safeInt(row[`${p}NSCOL15P_SUP5`]   ?? '') ?? 0;
    const sup   = sup2 + sup34 + sup5 > 0 ? sup2 + sup34 + sup5 : null;
    const total = safeInt(row[`${p}NSCOL15P`] ?? '');
    const taux  = sup !== null && total && total > 0
      ? Math.round(sup / total * 1000) / 10
      : null;
    out[code] = { nb_diplome_aucun: aucun, nb_diplome_bac: bac, nb_diplome_sup: sup, taux_diplome_sup: taux };
  }
  return out;
}

function buildLog(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const p = `P${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code  = irisCode(row);
    if (code.length < 9) continue;
    const prop  = safeInt(row[`${p}RP_PROP`] ?? '');
    const total = safeInt(row[`${p}RP`]      ?? '');
    if (prop !== null && total && total > 0)
      out[code] = { taux_proprio: Math.round(prop / total * 1000) / 10 };
  }
  return out;
}

function buildAct(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const p = `P${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code = irisCode(row);
    if (code.length < 9) continue;
    const chom = safeInt(row[`${p}CHOM1564`] ?? '');
    const act  = safeInt(row[`${p}ACT1564`]  ?? '');
    if (chom !== null && act && act > 0)
      out[code] = { taux_chomage: Math.round(chom / act * 1000) / 10 };
  }
  return out;
}

const BUILDERS = { pop: buildPop, men: buildMen, dip: buildDip, log: buildLog, act: buildAct } as const;

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    sources: string[];
    year:    string;
    dept?:   string;
    dryRun?: boolean;
  };
  const { sources = ['pop','men','dip','log','act'], year = '2020', dept, dryRun = false } = body;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      const deptFilter = dept ? dept.padStart(2, '0') : null;
      const allUpdates: Record<string, Record<string, unknown>> = {};

      const yearSuffix = year.slice(2); // '2020' → '20'

      for (const src of sources) {
        const url = INSEE_URLS[year]?.[src];
        if (!url) {
          send({ type: 'error', source: src, message: `Millésime ${year} non disponible pour "${src}"` });
          continue;
        }

        send({ type: 'log', source: src, message: `Téléchargement ${SOURCE_LABELS[src] ?? src}…` });

        let csvBuffer: Buffer;
        try {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'GENESIS-ETL/1.0' },
            signal: AbortSignal.timeout(180_000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const arrayBuf = await resp.arrayBuffer();
          const zipBuf   = Buffer.from(arrayBuf);
          send({ type: 'log', source: src, message: `${(zipBuf.length / 1024 / 1024).toFixed(1)} Mo reçus` });
          csvBuffer = await extractCsvFromZip(zipBuf);
        } catch (e) {
          send({ type: 'error', source: src, message: `Téléchargement échoué : ${String(e)}` });
          continue;
        }

        let rows: Record<string, string>[];
        try {
          rows = parseCsv(csvBuffer);
          send({ type: 'log', source: src, message: `${rows.length.toLocaleString('fr-FR')} lignes lues` });
        } catch (e) {
          send({ type: 'error', source: src, message: `Parse CSV échoué : ${String(e)}` });
          continue;
        }

        const builder = BUILDERS[src as keyof typeof BUILDERS];
        const updates = builder(rows, yearSuffix);

        let kept = 0;
        for (const [code, vals] of Object.entries(updates)) {
          if (deptFilter && !code.startsWith(deptFilter)) continue;
          allUpdates[code] = { ...(allUpdates[code] ?? {}), ...vals };
          kept++;
        }

        send({ type: 'source_done', source: src, count: kept });
      }

      const totalIris = Object.keys(allUpdates).length;
      send({ type: 'log', message: `Total : ${totalIris.toLocaleString('fr-FR')} IRIS uniques` });

      if (dryRun) {
        send({ type: 'done', total: totalIris, dryRun: true });
        controller.close();
        return;
      }

      // Update par batch via RPC (UPDATE uniquement — pas d'INSERT, préserve les valeurs existantes)
      const supabase = createAdminClient();
      const updateRows = Object.entries(allUpdates).map(([code_iris, vals]) => ({
        code_iris,
        ...Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== null)),
      }));

      let done = 0;
      for (let i = 0; i < updateRows.length; i += BATCH) {
        const batch = updateRows.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const { error } = await supabase.rpc('update_iris_core_batch', { p_rows: batch });
        if (error) {
          send({ type: 'error', message: `Batch ${batchNum} : ${error.message}` });
        }
        done += batch.length;
        send({ type: 'progress', done, total: updateRows.length });
      }

      send({ type: 'done', total: done, dryRun: false });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
