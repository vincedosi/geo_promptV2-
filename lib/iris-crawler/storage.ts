import fs from 'fs/promises';
import path from 'path';
import type { DownloadedBase, CatalogStatus } from './types';
import { classifyTarget } from './db-columns';
import { parseInseeValue, isGeoColumn } from './parser';

const DOWNLOAD_DIR = path.join(process.cwd(), 'data', 'iris-downloads');

export async function ensureDownloadDir(): Promise<void> {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

export function getFilePath(catalogId: string): string {
  return path.join(DOWNLOAD_DIR, `${catalogId}.json`);
}

export async function saveBase(data: DownloadedBase): Promise<void> {
  await ensureDownloadDir();
  await fs.writeFile(getFilePath(data.catalogId), JSON.stringify(data), 'utf-8');
}

export async function loadBase(catalogId: string): Promise<DownloadedBase | null> {
  try {
    const raw = await fs.readFile(getFilePath(catalogId), 'utf-8');
    return JSON.parse(raw) as DownloadedBase;
  } catch {
    return null;
  }
}

export async function getBaseStatus(catalogId: string): Promise<CatalogStatus> {
  try {
    const filePath = getFilePath(catalogId);
    const stat = await fs.stat(filePath);
    // Lire seulement les métadonnées (évite de charger 50MB en RAM)
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as DownloadedBase;
    return {
      catalogId,
      downloaded: true,
      downloadedAt: data.downloadedAt,
      rowCount: data.rowCount,
      columnCount: data.headers.length,
      csvFileName: data.csvFileName,
      fileSizeBytes: stat.size,
    };
  } catch {
    return { catalogId, downloaded: false };
  }
}

export async function deleteBase(catalogId: string): Promise<void> {
  try {
    await fs.unlink(getFilePath(catalogId));
  } catch { /* ignore */ }
}

// ── Logique hybride core / JSONB ──────────────────────────────────────────────

export interface SplitRowResult {
  /** Colonnes SQL fixes : { code_iris, population, rev_median, … } */
  coreData: Record<string, string | number | null>;
  /** Indicateurs JSONB : { DEC_D121: 9200, DEC_GI21: 0.31, … } — peut être vide */
  jsonbData: Record<string, string | number | null>;
  /** true si la ligne a des données valides (code_iris non vide) */
  valid: boolean;
}

/**
 * Découpe une ligne CSV en données core (colonnes SQL fixes) et indicateurs JSONB.
 *
 * Règle :
 *   classifyTarget(dbTarget) === 'core'   → coreData[dbTarget] = valeur parsée
 *   classifyTarget(dbTarget) === 'jsonb'  → jsonbData[dbTarget] = valeur parsée
 *   classifyTarget(dbTarget) === 'ignore' → ignoré
 *
 * @param row       - Ligne CSV brute (Record<csvCol, string>)
 * @param irisKeyCol - Nom de la colonne CSV contenant le code IRIS
 * @param mapping   - csvCol → dbTarget ('core col' | 'clé JSONB' | 'ignore')
 */
export function splitRow(
  row: Record<string, string>,
  irisKeyCol: string,
  mapping: Record<string, string>,
): SplitRowResult {
  const irisCode = row[irisKeyCol]?.trim();
  if (!irisCode) return { coreData: {}, jsonbData: {}, valid: false };

  const coreData: Record<string, string | number | null> = { code_iris: irisCode };
  const jsonbData: Record<string, string | number | null> = {};

  for (const [csvCol, dbTarget] of Object.entries(mapping)) {
    const target = classifyTarget(dbTarget);
    if (target === 'ignore') continue;

    const rawVal = row[csvCol] ?? '';
    const parsed = isGeoColumn(csvCol)
      ? (rawVal.trim() || null)
      : parseInseeValue(rawVal, csvCol);

    if (target === 'core') {
      coreData[dbTarget] = parsed;
    } else {
      // 'jsonb' — clé = dbTarget (= nom CSV original pour les JSONB non-matchés)
      jsonbData[dbTarget] = parsed;
    }
  }

  return { coreData, jsonbData, valid: true };
}

/**
 * Calcule les colonnes core dérivées de plusieurs sources CSV.
 * Appeler après splitRow. Supprime les clés __src_* du jsonbData.
 */
export function computeDerived(
  coreData: Record<string, string | number | null>,
  jsonbData: Record<string, string | number | null>,
): void {
  // taux_chomage = CHOM1564 / ACT1564 × 100
  const chom = jsonbData['__src_chom'];
  const act  = jsonbData['__src_act'];
  if (chom !== null && act !== null && typeof chom === 'number' && typeof act === 'number' && act > 0) {
    coreData['taux_chomage'] = Math.round(chom / act * 1000) / 10;
  }
  delete jsonbData['__src_chom'];
  delete jsonbData['__src_act'];

  // taux_proprio = RP_PROP / RP × 100
  const prop = jsonbData['__src_prop'];
  const rp   = jsonbData['__src_rp'];
  if (prop !== null && rp !== null && typeof prop === 'number' && typeof rp === 'number' && rp > 0) {
    coreData['taux_proprio'] = Math.round(prop / rp * 1000) / 10;
  }
  delete jsonbData['__src_prop'];
  delete jsonbData['__src_rp'];

  // nb_diplome_sup = SUP2 + SUP34 + SUP5
  const sup2  = jsonbData['__src_sup2'];
  const sup34 = jsonbData['__src_sup34'];
  const sup5  = jsonbData['__src_sup5'];
  const nscol = jsonbData['__src_nscol'];
  const hasSup = sup2 !== undefined || sup34 !== undefined || sup5 !== undefined;
  if (hasSup) {
    const s2  = typeof sup2  === 'number' ? sup2  : 0;
    const s34 = typeof sup34 === 'number' ? sup34 : 0;
    const s5  = typeof sup5  === 'number' ? sup5  : 0;
    const sup = s2 + s34 + s5;
    if (sup > 0) coreData['nb_diplome_sup'] = sup;
    if (typeof nscol === 'number' && nscol > 0 && sup > 0) {
      coreData['taux_diplome_sup'] = Math.round(sup / nscol * 1000) / 10;
    }
  }
  delete jsonbData['__src_sup2'];
  delete jsonbData['__src_sup34'];
  delete jsonbData['__src_sup5'];
  delete jsonbData['__src_nscol'];
}
