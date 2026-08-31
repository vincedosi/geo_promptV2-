/**
 * ANFR data parser — download ZIP from data.gouv.fr, parse CSV, filter radio emitters
 *
 * Data model:
 * - SUP_EMETTEUR.txt: EMR_ID, EMR_LB_SYSTEME (filter 'FM' + 'RDF T-DAB'), STA_NM_ANFR
 * - SUP_BANDE.txt: EMR_ID → BAN_NB_F_DEB (frequency in MHz)
 * - SUP_STATION.txt: STA_NM_ANFR → ADM_ID (exploitant link)
 * - SUP_SUPPORT.txt: STA_NM_ANFR → coordinates, height, address
 * - SUP_EXPLOITANT.txt (ref ZIP): ADM_ID → ADM_LB_NOM (exploitant name)
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import type { EmetteurRadioInsert } from './types';

const DATASET_API = 'https://www.data.gouv.fr/api/1/datasets/donnees-sur-les-installations-radioelectriques-de-plus-de-5-watts-1/';
const ALLOWED_HOSTS = ['www.data.gouv.fr', 'static.data.gouv.fr', 'files.data.gouv.fr', 'data.gouv.fr'];
const MAX_REDIRECTS = 3;

type ProgressCallback = (phase: string, current: number, total: number) => void;

/** Whitelist SSRF réutilisée pour l'URL initiale ET pour chaque Location de redirection. */
function isAllowedAnfrHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
}

/**
 * fetch() qui revalide le hostname à CHAQUE saut de redirection (fetch suit
 * les 3xx par défaut sans revalider la cible — un domaine whitelisté peut
 * rediriger vers une IP interne). Boucle bornée à MAX_REDIRECTS.
 */
async function fetchWithSsrfGuard(url: string, opts: RequestInit): Promise<Response> {
  let currentUrl = url;
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) throw new Error(`Trop de redirections (max ${MAX_REDIRECTS})`);
    const parsed = new URL(currentUrl);
    if (!isAllowedAnfrHost(parsed.hostname)) {
      throw new Error(`Domaine non autorisé: ${parsed.hostname}`);
    }
    const res = await fetch(currentUrl, { ...opts, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirection sans en-tête Location');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
}

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


export async function downloadAndParseAnfr(
  onProgress?: ProgressCallback,
): Promise<{ emetteurs: EmetteurRadioInsert[]; snapshotDate: string }> {

  // 1. Find latest ZIP URLs
  onProgress?.('Recherche des fichiers ANFR...', 0, 1);
  const datasetRes = await fetchWithSsrfGuard(DATASET_API, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!datasetRes.ok) throw new Error(`data.gouv.fr API: HTTP ${datasetRes.status}`);

  const dataset = await datasetRes.json() as {
    resources: Array<{ url: string; title: string; format: string; last_modified: string }>;
  };

  // Find data ZIP (larger one ~65MB) and reference ZIP (~5KB)
  const zipResources = dataset.resources.filter(r => r.format?.toLowerCase() === 'zip');
  const dataZip = zipResources.find(r => r.title?.toLowerCase().includes('supports antennes') || (r.url?.includes('data.zip')));
  const refZip = zipResources.find(r => r.title?.toLowerCase().includes('référence') || r.title?.toLowerCase().includes('reference') || (r.url?.includes('ref.zip')));

  if (!dataZip?.url) throw new Error('Aucun fichier ZIP data trouvé dans le dataset ANFR');

  // Validate URLs (échec rapide avant tout téléchargement)
  for (const res of [dataZip, refZip].filter(Boolean)) {
    const u = new URL(res!.url);
    if (!isAllowedAnfrHost(u.hostname)) {
      throw new Error(`Domaine non autorisé: ${u.hostname}`);
    }
  }

  const snapshotDate = dataZip.last_modified?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  // 2. Download both ZIPs
  onProgress?.('Téléchargement du ZIP principal (~65 Mo)...', 0, 2);
  const fetchOpts = {
    headers: { 'User-Agent': 'MAGELIAN/1.0 (Dentsu France; geospatial research)' },
    signal: AbortSignal.timeout(300_000),
  };

  const dataRes = await fetchWithSsrfGuard(dataZip.url, fetchOpts);
  if (!dataRes.ok) throw new Error(`Téléchargement data ZIP: HTTP ${dataRes.status}`);
  const dataBuf = await dataRes.arrayBuffer();
  onProgress?.(`ZIP principal téléchargé (${(dataBuf.byteLength / 1024 / 1024).toFixed(1)} Mo)`, 1, 2);

  // Download reference ZIP for exploitant names
  let exploitantMap = new Map<string, string>(); // ADM_ID → ADM_LB_NOM
  if (refZip?.url) {
    onProgress?.('Téléchargement du ZIP de référence...', 1, 2);
    const refRes = await fetchWithSsrfGuard(refZip.url, fetchOpts);
    if (refRes.ok) {
      const refBuf = await refRes.arrayBuffer();
      const refZipObj = await JSZip.loadAsync(refBuf);
      let exploitantFile: JSZip.JSZipObject | null = null;
      refZipObj.forEach((path, file) => {
        if (!file.dir && path.toUpperCase().includes('SUP_EXPLOITANT')) exploitantFile = file;
      });
      if (exploitantFile) {
        const csv = await (exploitantFile as JSZip.JSZipObject).async('string');
        const parsed = Papa.parse<Record<string, string>>(csv, { header: true, delimiter: ';', skipEmptyLines: true });
        for (const row of parsed.data) {
          const id = (row.ADM_ID ?? '').trim();
          const nom = (row.ADM_LB_NOM ?? '').trim();
          if (id && nom) exploitantMap.set(id, nom);
        }
        onProgress?.(`${exploitantMap.size} exploitants chargés`, 2, 2);
      }
    }
  }

  // 3. Parse data ZIP
  onProgress?.('Extraction et parsing...', 0, 5);
  const zip = await JSZip.loadAsync(dataBuf);

  const findFile = (pattern: string): JSZip.JSZipObject => {
    let found: JSZip.JSZipObject | null = null;
    zip.forEach((path, file) => {
      if (!file.dir && path.toUpperCase().includes(pattern)) found = file;
    });
    if (!found) throw new Error(`${pattern} introuvable dans le ZIP`);
    return found;
  };

  // Parse SUP_EMETTEUR — filter FM + DAB+
  onProgress?.('Parsing SUP_EMETTEUR (filtre FM + DAB+)...', 1, 5);
  const emetteurCsv = await findFile('SUP_EMETTEUR').async('string');
  const emetteurRows = Papa.parse<Record<string, string>>(emetteurCsv, { header: true, delimiter: ';', skipEmptyLines: true });

  const SYSTEME_MAP: Record<string, 'FM' | 'DAB+'> = {
    'FM': 'FM',
    'RDF T-DAB': 'DAB+',
  };

  // Build emitter map: EMR_ID → { systeme, sta_nm_anfr }
  const emitterMap = new Map<string, { systeme: 'FM' | 'DAB+'; sta_nm_anfr: string }>();
  for (const row of emetteurRows.data) {
    const sys = SYSTEME_MAP[(row.EMR_LB_SYSTEME ?? '').trim()];
    if (!sys) continue;
    const emrId = (row.EMR_ID ?? '').trim();
    const staNm = (row.STA_NM_ANFR ?? '').trim();
    if (emrId && staNm) emitterMap.set(emrId, { systeme: sys, sta_nm_anfr: staNm });
  }
  onProgress?.(`${emitterMap.size} émetteurs radio trouvés (FM + DAB+)`, 1, 5);

  // Parse SUP_BANDE — get frequencies
  onProgress?.('Parsing SUP_BANDE (fréquences)...', 2, 5);
  const bandeCsv = await findFile('SUP_BANDE').async('string');
  const bandeRows = Papa.parse<Record<string, string>>(bandeCsv, { header: true, delimiter: ';', skipEmptyLines: true });

  const freqMap = new Map<string, number>(); // EMR_ID → frequency MHz
  for (const row of bandeRows.data) {
    const emrId = (row.EMR_ID ?? '').trim();
    if (!emitterMap.has(emrId)) continue;
    const freqStr = (row.BAN_NB_F_DEB ?? '').replace(',', '.').trim();
    const freq = parseFloat(freqStr);
    if (!isNaN(freq) && freq > 0) {
      freqMap.set(emrId, freq);
    }
  }
  onProgress?.(`${freqMap.size} fréquences associées`, 2, 5);

  // Parse SUP_STATION — get ADM_ID for exploitant
  onProgress?.('Parsing SUP_STATION (exploitants)...', 3, 5);
  const stationCsv = await findFile('SUP_STATION').async('string');
  const stationRows = Papa.parse<Record<string, string>>(stationCsv, { header: true, delimiter: ';', skipEmptyLines: true });

  const stationAdmMap = new Map<string, string>(); // STA_NM_ANFR → ADM_ID
  for (const row of stationRows.data) {
    const staNm = (row.STA_NM_ANFR ?? '').trim();
    const admId = (row.ADM_ID ?? '').trim();
    if (staNm && admId) stationAdmMap.set(staNm, admId);
  }

  // Parse SUP_SUPPORT — coordinates, height, address
  onProgress?.('Parsing SUP_SUPPORT (coordonnées GPS)...', 4, 5);
  const supportCsv = await findFile('SUP_SUPPORT').async('string');
  const supportRows = Papa.parse<Record<string, string>>(supportCsv, { header: true, delimiter: ';', skipEmptyLines: true });

  const supportMap = new Map<string, Record<string, string>>();
  for (const row of supportRows.data) {
    const key = (row.STA_NM_ANFR ?? '').trim();
    if (key) supportMap.set(key, row);
  }

  // 4. Build final emitter list
  onProgress?.('Construction de la liste finale...', 5, 5);
  const results: EmetteurRadioInsert[] = [];
  let noCoords = 0;

  for (const [emrId, em] of emitterMap) {
    const support = supportMap.get(em.sta_nm_anfr);

    let lat: number | null = null;
    let lon: number | null = null;

    if (support) {
      lat = parseCoord(support.COR_NB_DG_LAT, support.COR_NB_MN_LAT, support.COR_NB_SC_LAT, support.COR_CD_NS_LAT);
      lon = parseCoord(support.COR_NB_DG_LON, support.COR_NB_MN_LON, support.COR_NB_SC_LON, support.COR_CD_EW_LON);
    }

    if (lat === null || lon === null || !isFinite(lat) || !isFinite(lon)) { noCoords++; continue; }
    if (lat < -22 || lat > 52 || lon < -64 || lon > 56) { noCoords++; continue; }

    // Get exploitant name via station → ADM_ID → exploitant table
    const admId = stationAdmMap.get(em.sta_nm_anfr);
    const exploitant = admId ? exploitantMap.get(admId) ?? null : null;

    // Get frequency
    const freq = freqMap.get(emrId) ?? null;

    // Get department from COM_CD_INSEE (first 2 chars, or 3 for DOM)
    const insee = (support?.COM_CD_INSEE ?? '').trim();
    let dept: string | null = null;
    if (insee.length >= 2) {
      dept = insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2);
    }

    results.push({
      sta_nm_anfr: em.sta_nm_anfr,
      systeme: em.systeme,
      frequence_mhz: freq,
      puissance_w: null, // puissance is in SUP_ANTENNE, not critical for now
      hauteur_m: support ? parseFloat(support.SUP_NM_HAUT ?? '') || null : null,
      exploitant,
      adresse: support ? (support.ADR_LB_LIEU ?? support.ADR_LB_ADD1 ?? '').trim() || null : null,
      commune: support ? (support.ADR_LB_ADD1 ?? support.ADR_LB_LIEU ?? '').trim() || null : null,
      departement: dept,
      lat,
      lon,
      snapshot_date: snapshotDate,
    });
  }

  if (noCoords > 0) {
    onProgress?.(`${noCoords} émetteurs sans coordonnées GPS (ignorés)`, 5, 5);
  }

  const totalFm = results.filter(e => e.systeme === 'FM').length;
  const totalDab = results.filter(e => e.systeme === 'DAB+').length;
  onProgress?.(`${results.length} émetteurs extraits (FM: ${totalFm}, DAB+: ${totalDab})`, 5, 5);

  return { emetteurs: results, snapshotDate };
}
