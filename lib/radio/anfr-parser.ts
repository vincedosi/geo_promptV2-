/**
 * ANFR data parser — download ZIP from data.gouv.fr, parse CSV, filter radio emitters
 *
 * Source: https://www.data.gouv.fr/datasets/donnees-sur-les-installations-radioelectriques-de-plus-de-5-watts-1/
 * Files inside ZIP: SUP_EMETTEUR.txt + SUP_SUPPORT.txt (CSV, separator ';')
 * Filter: EMR_LB_SYSTEME IN ('RDF FM', 'RDF T-DAB')
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import type { EmetteurRadioInsert } from './types';

// ── ANFR dataset URL via data.gouv.fr API ─────────────────────────────────────
const DATASET_API = 'https://www.data.gouv.fr/api/1/datasets/donnees-sur-les-installations-radioelectriques-de-plus-de-5-watts-1/';

const ALLOWED_HOSTS = ['www.data.gouv.fr', 'static.data.gouv.fr', 'files.data.gouv.fr', 'data.gouv.fr'];

type ProgressCallback = (phase: string, current: number, total: number) => void;

// ── Coordinate conversion (DMS or decimal) ────────────────────────────────────

function parseCoord(degStr: string | undefined, minStr: string | undefined, secStr: string | undefined, dirStr: string | undefined): number | null {
  const deg = parseFloat(degStr ?? '');
  if (isNaN(deg)) return null;

  const min = parseFloat(minStr ?? '0') || 0;
  const sec = parseFloat(secStr ?? '0') || 0;

  let decimal = deg + min / 60 + sec / 3600;

  const dir = (dirStr ?? '').trim().toUpperCase();
  if (dir === 'S' || dir === 'W' || dir === 'O') decimal = -decimal;

  return decimal;
}

// ── Main parser ───────────────────────────────────────────────────────────────

export async function downloadAndParseAnfr(
  onProgress?: ProgressCallback,
): Promise<{ emetteurs: EmetteurRadioInsert[]; snapshotDate: string }> {
  // 1. Find latest ZIP URL from data.gouv.fr API
  onProgress?.('Recherche du fichier ANFR...', 0, 1);

  const datasetRes = await fetch(DATASET_API, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!datasetRes.ok) throw new Error(`data.gouv.fr API: HTTP ${datasetRes.status}`);

  const dataset = await datasetRes.json() as {
    resources: Array<{ url: string; title: string; format: string; last_modified: string }>;
  };

  // Find the main ZIP resource (the largest one, or the one with "emet" in the title)
  const zipResource = dataset.resources.find(r =>
    r.format?.toLowerCase() === 'zip' &&
    (r.title?.toLowerCase().includes('emet') || r.title?.toLowerCase().includes('sup_'))
  ) ?? dataset.resources.find(r => r.format?.toLowerCase() === 'zip');

  if (!zipResource?.url) throw new Error('Aucun fichier ZIP trouvé dans le dataset ANFR');

  // Validate URL against allowed hosts
  const zipUrl = new URL(zipResource.url);
  if (!ALLOWED_HOSTS.some(h => zipUrl.hostname === h || zipUrl.hostname.endsWith('.' + h))) {
    throw new Error(`Domaine non autorisé: ${zipUrl.hostname}`);
  }

  const snapshotDate = zipResource.last_modified
    ? zipResource.last_modified.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // 2. Download the ZIP
  onProgress?.('Téléchargement du ZIP ANFR...', 0, 1);

  const zipRes = await fetch(zipResource.url, {
    headers: { 'User-Agent': 'GEOMATIK/1.0 (Dentsu France; geospatial research)' },
    signal: AbortSignal.timeout(300_000), // 5 min timeout for ~64MB
  });
  if (!zipRes.ok) throw new Error(`Téléchargement ZIP: HTTP ${zipRes.status}`);

  const zipBuffer = await zipRes.arrayBuffer();
  onProgress?.(`ZIP téléchargé (${(zipBuffer.byteLength / 1024 / 1024).toFixed(1)} Mo)`, 1, 1);

  // 3. Extract CSV files from ZIP
  onProgress?.('Extraction du ZIP...', 0, 1);
  const zip = await JSZip.loadAsync(zipBuffer);

  // Find SUP_EMETTEUR and SUP_SUPPORT files
  const findFile = (pattern: string) => {
    let found: JSZip.JSZipObject | null = null;
    zip.forEach((path, file) => {
      if (!file.dir && path.toUpperCase().includes(pattern)) found = file;
    });
    return found;
  };

  const emetteurFile = findFile('SUP_EMETTEUR');
  const supportFile = findFile('SUP_SUPPORT');

  if (!emetteurFile) throw new Error('SUP_EMETTEUR.txt introuvable dans le ZIP');
  if (!supportFile) throw new Error('SUP_SUPPORT.txt introuvable dans le ZIP');

  // 4. Parse CSVs
  onProgress?.('Parsing SUP_SUPPORT...', 0, 2);
  const supportCsv = await (supportFile as JSZip.JSZipObject).async('string');
  const supports = Papa.parse<Record<string, string>>(supportCsv, {
    header: true, delimiter: ';', skipEmptyLines: true,
  });

  // Build support lookup by STA_NM_ANFR
  const supportMap = new Map<string, Record<string, string>>();
  for (const row of supports.data) {
    const key = (row.STA_NM_ANFR ?? row.sta_nm_anfr ?? '').trim();
    if (key) supportMap.set(key, row);
  }
  onProgress?.(`${supportMap.size} supports parsés`, 1, 2);

  onProgress?.('Parsing SUP_EMETTEUR (filtrage radio)...', 1, 2);
  const emetteurCsv = await (emetteurFile as JSZip.JSZipObject).async('string');
  const emetteurs = Papa.parse<Record<string, string>>(emetteurCsv, {
    header: true, delimiter: ';', skipEmptyLines: true,
  });

  // 5. Filter radio emitters and join with supports
  const SYSTEME_MAP: Record<string, 'FM' | 'DAB+'> = {
    'RDF FM': 'FM',
    'RDF T-DAB': 'DAB+',
  };

  const results: EmetteurRadioInsert[] = [];
  let skipped = 0;

  for (const row of emetteurs.data) {
    const rawSysteme = (row.EMR_LB_SYSTEME ?? row.emr_lb_systeme ?? '').trim();
    const systeme = SYSTEME_MAP[rawSysteme];
    if (!systeme) { skipped++; continue; } // Not a radio emitter

    const staNm = (row.STA_NM_ANFR ?? row.sta_nm_anfr ?? '').trim();
    if (!staNm) { skipped++; continue; }

    const support = supportMap.get(staNm);

    // Parse coordinates from support
    let lat: number | null = null;
    let lon: number | null = null;

    if (support) {
      // Try DMS fields first (SUP_NM_LAT, SUP_NM_LONG with degrees/minutes/seconds)
      lat = parseCoord(
        support.COR_NB_DG_LAT ?? support.cor_nb_dg_lat,
        support.COR_NB_MN_LAT ?? support.cor_nb_mn_lat,
        support.COR_NB_SC_LAT ?? support.cor_nb_sc_lat,
        support.COR_CD_NS_LAT ?? support.cor_cd_ns_lat,
      );
      lon = parseCoord(
        support.COR_NB_DG_LON ?? support.cor_nb_dg_lon,
        support.COR_NB_MN_LON ?? support.cor_nb_mn_lon,
        support.COR_NB_SC_LON ?? support.cor_nb_sc_lon,
        support.COR_CD_EW_LON ?? support.cor_cd_ew_lon,
      );
    }

    if (lat === null || lon === null || !isFinite(lat) || !isFinite(lon)) continue;
    // Basic sanity check for France
    if (lat < -22 || lat > 52 || lon < -64 || lon > 56) continue;

    const freq = parseFloat(row.EMR_DT_SERVICE ?? row.emr_dt_service ?? '');
    const puissance = parseFloat(row.EMR_NB_PUISSANCE ?? row.emr_nb_puissance ?? '');

    results.push({
      sta_nm_anfr: staNm,
      systeme,
      frequence_mhz: isNaN(freq) ? null : freq,
      puissance_w: isNaN(puissance) ? null : puissance,
      hauteur_m: support ? parseFloat(support.SUP_NM_HAUT ?? support.sup_nm_haut ?? '') || null : null,
      exploitant: (row.ADM_LB_NOM ?? row.adm_lb_nom ?? '').trim() || null,
      adresse: support ? (support.STA_NM_ADRESSE1 ?? support.sta_nm_adresse1 ?? '').trim() || null : null,
      commune: support ? (support.COM_LB_NOM ?? support.com_lb_nom ?? '').trim() || null : null,
      departement: support ? (support.DPT_NB ?? support.dpt_nb ?? '').trim().padStart(2, '0') || null : null,
      lat,
      lon,
      snapshot_date: snapshotDate,
    });
  }

  onProgress?.(`${results.length} émetteurs radio extraits (${skipped} non-radio ignorés)`, 2, 2);

  return { emetteurs: results, snapshotDate };
}
