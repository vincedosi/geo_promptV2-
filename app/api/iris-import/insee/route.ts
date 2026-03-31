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
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

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
    const pop       = safeInt(row[`${p}POP`]      ?? '');
    const pop_0_14  = safeInt(row[`${p}POP0014`]  ?? '');
    const pop_60_74 = safeInt(row[`${p}POP6074`]  ?? '');
    const pop_75p   = safeInt(row[`${p}POP75P`]   ?? '');
    const pop_etr   = safeInt(row[`${p}POP_ETR`]  ?? '');
    const entry: Record<string, number | null> = {
      population:    pop,
      pop_0_14,
      pop_15_29:     safeInt(row[`${p}POP1529`]  ?? ''),
      pop_30_44:     safeInt(row[`${p}POP3044`]  ?? ''),
      pop_45_59:     safeInt(row[`${p}POP4559`]  ?? ''),
      pop_60_74,
      pop_75_plus:   pop_75p,
      nb_csp_cadre:  safeInt(row[`${c}POP15P_CS3`] ?? ''),
      nb_csp_employe: safeInt(row[`${c}POP15P_CS5`] ?? ''),
      nb_csp_ouvrier: safeInt(row[`${c}POP15P_CS6`] ?? ''),
    };
    // Indicateurs dérivés démographiques
    if (pop !== null && pop > 0) {
      if (pop_0_14 !== null)
        entry.part_pop_moins_18 = Math.round(pop_0_14 / pop * 1000) / 10;
      if (pop_60_74 !== null && pop_75p !== null)
        entry.part_pop_65_plus = Math.round((pop_60_74 + pop_75p) / pop * 1000) / 10;
      if (pop_etr !== null)
        entry.part_pop_etrangere = Math.round(pop_etr / pop * 1000) / 10;
    }
    if (pop_0_14 !== null && pop_60_74 !== null && pop_75p !== null) {
      const agee = pop_60_74 + pop_75p;
      if (agee > 0) entry.indice_jeunesse = Math.round(pop_0_14 / agee * 100) / 100;
    }
    out[code] = entry;
  }
  return out;
}

function buildMen(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const c = `C${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code = irisCode(row);
    if (code.length < 9) continue;
    const nb_men   = safeInt(row[`${c}MEN`]        ?? '');
    const fam      = safeInt(row[`${c}FAM`]        ?? '');
    const fam_mono = safeInt(row[`${c}FAMMONO`]    ?? '');
    const coup_enf = safeInt(row[`${c}COUPENFANT`] ?? '');
    const entry: Record<string, number | null> = { nb_menages: nb_men };
    if (fam !== null && fam > 0) {
      if (fam_mono !== null)
        entry.part_familles_monoparentales = Math.round(fam_mono / fam * 1000) / 10;
      if (coup_enf !== null)
        entry.part_couples_avec_enfants = Math.round(coup_enf / fam * 1000) / 10;
    }
    if (Object.keys(entry).some(k => entry[k] !== null)) out[code] = entry;
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
    const part_sans = aucun !== null && total && total > 0
      ? Math.round(aucun / total * 1000) / 10
      : null;
    out[code] = { nb_diplome_aucun: aucun, nb_diplome_bac: bac, nb_diplome_sup: sup, taux_diplome_sup: taux, part_sans_diplome: part_sans };
  }
  return out;
}

function buildLog(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const p = `P${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code      = irisCode(row);
    if (code.length < 9) continue;
    const prop      = safeInt(row[`${p}RP_PROP`]     ?? '');
    const rp        = safeInt(row[`${p}RP`]          ?? '');
    const log_total = safeInt(row[`${p}LOG`]         ?? '');
    const appart    = safeInt(row[`${p}APPART`]      ?? '');
    const hlm       = safeInt(row[`${p}RP_LOCHLMV`]  ?? '');
    const anem      = safeInt(row[`${p}RP_ANEM0002`] ?? '');
    const entry: Record<string, number | null> = {};
    if (prop !== null && rp !== null && rp > 0)
      entry.taux_proprio = Math.round(prop / rp * 1000) / 10;
    if (rp !== null && log_total !== null && log_total > 0)
      entry.part_residences_principales = Math.round(rp / log_total * 1000) / 10;
    if (appart !== null && log_total !== null && log_total > 0)
      entry.part_appartements = Math.round(appart / log_total * 1000) / 10;
    if (hlm !== null && rp !== null && rp > 0)
      entry.part_logements_sociaux = Math.round(hlm / rp * 1000) / 10;
    if (anem !== null && rp !== null && rp > 0)
      entry.part_menages_emmenages_2ans = Math.round(anem / rp * 1000) / 10;
    if (Object.keys(entry).length > 0) out[code] = entry;
  }
  return out;
}

function buildAct(rows: Record<string, string>[], y: string): Record<string, Record<string, number | null>> {
  const p = `P${y}_`;
  const c = `C${y}_`;
  const out: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    const code       = irisCode(row);
    if (code.length < 9) continue;
    const chom       = safeInt(row[`${p}CHOM1564`]       ?? '');
    const act        = safeInt(row[`${p}ACT1564`]        ?? '');
    const actocc     = safeInt(row[`${p}ACTOCC1564`]     ?? '');
    // nb_emplois (P_EMPLT) n'est pas dans ce dataset — fichier "Emploi - Population active" (EMP)
    const act_pas    = safeInt(row[`${c}ACTOCC15P_PAS`]  ?? '');
    const act_velo   = safeInt(row[`${c}ACTOCC15P_VELO`] ?? '');
    const act_tcom   = safeInt(row[`${c}ACTOCC15P_TCOM`] ?? '');
    const act_occ15p = safeInt(row[`${c}ACTOCC15P`]      ?? '');
    const h_act      = safeInt(row[`${p}HACT1564`]       ?? '');
    const h_tot      = safeInt(row[`${p}H1564`]          ?? '');
    const f_act      = safeInt(row[`${p}FACT1564`]       ?? '');
    const f_tot      = safeInt(row[`${p}F1564`]          ?? '');
    const entry: Record<string, number | null> = {};
    if (chom !== null && act && act > 0)
      entry.taux_chomage = Math.round(chom / act * 1000) / 10;
    if (actocc !== null && act && act > 0)
      entry.taux_emploi = Math.round(actocc / act * 1000) / 10;
    if (act_occ15p !== null && act_occ15p > 0) {
      const marche = (act_pas ?? 0) + (act_velo ?? 0);
      if (act_pas !== null || act_velo !== null)
        entry.part_actifs_marche_velo = Math.round(marche / act_occ15p * 1000) / 10;
      if (act_tcom !== null)
        entry.part_actifs_transport_commun = Math.round(act_tcom / act_occ15p * 1000) / 10;
    }
    if (h_act !== null && h_tot !== null && h_tot > 0)
      entry.part_hommes_actifs = Math.round(h_act / h_tot * 1000) / 10;
    if (f_act !== null && f_tot !== null && f_tot > 0)
      entry.part_femmes_actives = Math.round(f_act / f_tot * 1000) / 10;
    if (Object.keys(entry).length > 0)
      out[code] = entry;
  }
  return out;
}

const BUILDERS = { pop: buildPop, men: buildMen, dip: buildDip, log: buildLog, act: buildAct } as const;

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

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
