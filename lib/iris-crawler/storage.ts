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
  const irisCode = String(row[irisKeyCol] ?? '').trim();
  if (!irisCode) return { coreData: {}, jsonbData: {}, valid: false };

  const coreData: Record<string, string | number | null> = { code_iris: irisCode };
  const jsonbData: Record<string, string | number | null> = {};

  for (const [csvCol, dbTarget] of Object.entries(mapping)) {
    const target = classifyTarget(dbTarget);
    if (target === 'ignore') continue;

    const rawVal = row[csvCol] ?? '';
    const parsed = isGeoColumn(csvCol)
      ? (String(rawVal).trim() || null)
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
// Arrondi à 1 décimale
function r1(n: number): number { return Math.round(n * 10) / 10; }
// Arrondi à 2 décimales
function r2(n: number): number { return Math.round(n * 100) / 100; }
// Lecture sûre d'un nombre dans coreData ou jsonbData
function num(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return v;
  return null;
}

export function computeDerived(
  coreData: Record<string, string | number | null>,
  jsonbData: Record<string, string | number | null>,
): void {
  // ── Lire toutes les sources partagées AVANT toute suppression ────────────────
  const act        = jsonbData['__src_act'];
  const rp         = jsonbData['__src_rp'];
  const log_total  = jsonbData['__src_log'];
  const nscol      = jsonbData['__src_nscol'];

  // ── Chômage & emploi ─────────────────────────────────────────────────────────
  const chom = jsonbData['__src_chom'];
  if (typeof chom === 'number' && typeof act === 'number' && act > 0) {
    coreData['taux_chomage'] = r1(chom / act * 100);
  }
  delete jsonbData['__src_chom'];

  const actocc = jsonbData['__src_actocc'];
  if (typeof actocc === 'number' && typeof act === 'number' && act > 0) {
    coreData['taux_emploi'] = r1(actocc / act * 100);
  }
  delete jsonbData['__src_actocc'];
  delete jsonbData['__src_act'];

  // ── Logement ─────────────────────────────────────────────────────────────────
  if (typeof rp === 'number' && typeof log_total === 'number' && log_total > 0) {
    coreData['part_residences_principales'] = r1(rp / log_total * 100);
  }

  const appart = jsonbData['__src_appart'];
  if (typeof appart === 'number' && typeof log_total === 'number' && log_total > 0) {
    coreData['part_appartements'] = r1(appart / log_total * 100);
  }
  delete jsonbData['__src_appart'];
  delete jsonbData['__src_log'];

  const hlm = jsonbData['__src_hlm'];
  if (typeof hlm === 'number' && typeof rp === 'number' && rp > 0) {
    coreData['part_logements_sociaux'] = r1(hlm / rp * 100);
  }
  delete jsonbData['__src_hlm'];

  const anem = jsonbData['__src_anem'];
  if (typeof anem === 'number' && typeof rp === 'number' && rp > 0) {
    coreData['part_menages_emmenages_2ans'] = r1(anem / rp * 100);
  }
  delete jsonbData['__src_anem'];

  // taux_proprio = RP_PROP / RP × 100
  const prop = jsonbData['__src_prop'];
  if (typeof prop === 'number' && typeof rp === 'number' && rp > 0) {
    coreData['taux_proprio'] = r1(prop / rp * 100);
  }
  delete jsonbData['__src_prop'];
  delete jsonbData['__src_rp'];

  // ── Familles ─────────────────────────────────────────────────────────────────
  const fam      = jsonbData['__src_fam'];
  const fam_mono = jsonbData['__src_fam_mono'];
  const coup_enf = jsonbData['__src_coup_enf'];
  if (typeof fam_mono === 'number' && typeof fam === 'number' && fam > 0) {
    coreData['part_familles_monoparentales'] = r1(fam_mono / fam * 100);
  }
  if (typeof coup_enf === 'number' && typeof fam === 'number' && fam > 0) {
    coreData['part_couples_avec_enfants'] = r1(coup_enf / fam * 100);
  }
  delete jsonbData['__src_fam'];
  delete jsonbData['__src_fam_mono'];
  delete jsonbData['__src_coup_enf'];

  // ── Mobilité ─────────────────────────────────────────────────────────────────
  const act_occ15p = jsonbData['__src_act_occ15p'];
  const act_pas    = jsonbData['__src_act_pas'];
  const act_velo   = jsonbData['__src_act_velo'];
  const act_tcom   = jsonbData['__src_act_tcom'];
  if (typeof act_occ15p === 'number' && act_occ15p > 0) {
    const marche = (typeof act_pas === 'number' ? act_pas : 0)
                 + (typeof act_velo === 'number' ? act_velo : 0);
    if (marche > 0 || act_pas !== undefined || act_velo !== undefined) {
      coreData['part_actifs_marche_velo'] = r1(marche / act_occ15p * 100);
    }
    if (typeof act_tcom === 'number') {
      coreData['part_actifs_transport_commun'] = r1(act_tcom / act_occ15p * 100);
    }
  }
  delete jsonbData['__src_act_pas'];
  delete jsonbData['__src_act_velo'];
  delete jsonbData['__src_act_tcom'];
  delete jsonbData['__src_act_occ15p'];

  // ── Activité par sexe ────────────────────────────────────────────────────────
  const h_act = jsonbData['__src_h_act'];
  const h_tot = jsonbData['__src_h_tot'];
  const f_act = jsonbData['__src_f_act'];
  const f_tot = jsonbData['__src_f_tot'];
  if (typeof h_act === 'number' && typeof h_tot === 'number' && h_tot > 0) {
    coreData['part_hommes_actifs'] = r1(h_act / h_tot * 100);
  }
  if (typeof f_act === 'number' && typeof f_tot === 'number' && f_tot > 0) {
    coreData['part_femmes_actives'] = r1(f_act / f_tot * 100);
  }
  delete jsonbData['__src_h_act'];
  delete jsonbData['__src_h_tot'];
  delete jsonbData['__src_f_act'];
  delete jsonbData['__src_f_tot'];

  // ── Diplômes ─────────────────────────────────────────────────────────────────
  const sup2  = jsonbData['__src_sup2'];
  const sup34 = jsonbData['__src_sup34'];
  const sup5  = jsonbData['__src_sup5'];
  const hasSup = sup2 !== undefined || sup34 !== undefined || sup5 !== undefined;
  if (hasSup) {
    const s2  = typeof sup2  === 'number' ? sup2  : 0;
    const s34 = typeof sup34 === 'number' ? sup34 : 0;
    const s5  = typeof sup5  === 'number' ? sup5  : 0;
    const sup = s2 + s34 + s5;
    if (sup > 0) coreData['nb_diplome_sup'] = sup;
    if (typeof nscol === 'number' && nscol > 0 && sup > 0) {
      coreData['taux_diplome_sup'] = r1(sup / nscol * 100);
    }
  }
  // part_sans_diplome = nb_diplome_aucun / nscol × 100 (avant suppression __src_nscol)
  const sans_dipl = num(coreData['nb_diplome_aucun']);
  if (sans_dipl !== null && typeof nscol === 'number' && nscol > 0) {
    coreData['part_sans_diplome'] = r1(sans_dipl / nscol * 100);
  }
  delete jsonbData['__src_sup2'];
  delete jsonbData['__src_sup34'];
  delete jsonbData['__src_sup5'];
  delete jsonbData['__src_nscol'];

  // ── Démographie (depuis colonnes core déjà calculées) ────────────────────────
  const pop_tot      = num(coreData['population']);
  const pop_0_14     = num(coreData['pop_0_14']);
  const pop_60_74    = num(coreData['pop_60_74']);
  const pop_75_plus  = num(coreData['pop_75_plus']);
  const pop_etr_src  = jsonbData['__src_pop_etr'];

  if (pop_tot !== null && pop_tot > 0) {
    if (pop_0_14 !== null) {
      coreData['part_pop_moins_18'] = r1(pop_0_14 / pop_tot * 100);
    }
    if (pop_60_74 !== null && pop_75_plus !== null) {
      coreData['part_pop_65_plus'] = r1((pop_60_74 + pop_75_plus) / pop_tot * 100);
    }
    if (typeof pop_etr_src === 'number') {
      coreData['part_pop_etrangere'] = r1(pop_etr_src / pop_tot * 100);
    }
  }
  delete jsonbData['__src_pop_etr'];

  if (pop_0_14 !== null && pop_60_74 !== null && pop_75_plus !== null) {
    const agee = pop_60_74 + pop_75_plus;
    if (agee > 0) {
      coreData['indice_jeunesse'] = r2(pop_0_14 / agee);
    }
  }
}
