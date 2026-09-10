/**
 * GEO.Prompt — Import Universel — Inserter
 * v5.0.0 — Supabase JS Client (plus besoin de DATABASE_URL)
 * Chaque INSERT → log OK / SKIP / ERR envoyé au client via callback
 */
import { createAdminClient } from '@/lib/auth';
import { triggerFilled } from '@/lib/supabase/tables';
import { logger } from '@/lib/logger';
import { invalidateCategoriesCache } from '@/lib/poi/categories';
import { enrichMissingGeo } from './geo-enricher';
import type { ProcessedRow, LogCallback } from './types';

const BATCH_SIZE = 50;

function getSupabase() {
  return createAdminClient();
}

// ============================================================
// POI Insert — poi table — batch via Supabase upsert
// ============================================================

async function insertPoiBatch(
  batch: ProcessedRow[],
  globalOffset: number,
  onLog?: LogCallback
): Promise<{ inserted: number; ignored: number; errors: number; firstError?: string }> {
  if (batch.length === 0) return { inserted: 0, ignored: 0, errors: 0 };

  const supabase = getSupabase();
  let inserted = 0;
  let ignored = 0;
  let errors = 0;
  let firstError: string | undefined;

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    const rowNum = globalOffset + i;
    const label = r.nom || r.id?.substring(0, 8) || '?';

    try {
      const row = triggerFilled<'poi_france', 'geom'>({
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        categorie: r.categorie || 'autre',
        sous_categorie: r.sous_categorie || null,
        nom: r.nom || null,
        adresse: r.adresse || null,
        ville: r.ville || null,
        code_postal: r.code_postal || null,
        departement: r.departement || null,
        code_departement: r.code_departement || null,
        region: r.region || null,
        source: r.source || 'import_universel',
        date_import: new Date().toISOString(),
        metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {},
      });

      if (r.data_source_id) row.data_source_id = r.data_source_id;
      if (r.organization_id) row.organization_id = r.organization_id;

      const { error: insertErr } = await supabase
        .from('poi_france')
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true });

      if (insertErr) {
        // Check for duplicate/conflict
        if (insertErr.code === '23505') {
          ignored++;
          const skipMsg = `[SKIP] #${rowNum} ${label} → doublon`;
          onLog?.('warn', skipMsg);
        } else {
          throw new Error(insertErr.message);
        }
      } else {
        inserted++;
        const okMsg = `[OK] #${rowNum} ${label} (${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}) → insere`;
        onLog?.('info', okMsg);
      }
    } catch (rowErr) {
      const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
      errors++;
      if (!firstError) firstError = msg;
      const errMsg = `[ERR] #${rowNum} ${label} → ${msg}`;
      console.error(`[INSERTER] ${errMsg}`);
      onLog?.('error', errMsg);
    }
  }

  return { inserted, ignored, errors, firstError };
}

// ============================================================
// Main dispatcher with progress + live logs
// ============================================================
// NB : le type 'panneaux' a été retiré avec la page /integration-panneaux
// (2026-07-02). Les panneaux s'importent via /admin/ooh-import (ArcGIS REST).

export async function insertRows(
  rows: ProcessedRow[],
  dataType: 'poi',
  onProgress?: (processed: number, total: number, inserted: number, ignored: number, errors: number) => void,
  onLog?: LogCallback
): Promise<{ inserted: number; ignored: number; errors: number; firstError?: string }> {

  const startMsg = `====== START: ${rows.length} lignes, type="${dataType}" (Supabase JS) ======`;
  logger.info('INSERTER', startMsg);
  onLog?.('info', startMsg);

  // Test connexion via Supabase
  try {
    const supabase = getSupabase();
    const tableName = 'poi_france';
    const { error } = await supabase.from(tableName).select('id').limit(1);
    if (error) throw error;
    const connMsg = `Connexion Supabase OK — table "${tableName}"`;
    logger.info('INSERTER', `${connMsg}`);
    onLog?.('info', connMsg);
  } catch (connErr) {
    const connErrMsg = `Connexion Supabase ECHOUEE: ${connErr instanceof Error ? connErr.message : String(connErr)}`;
    console.error(`[INSERTER] ${connErrMsg}`);
    onLog?.('error', connErrMsg);
    return { inserted: 0, ignored: 0, errors: rows.length, firstError: connErrMsg };
  }

  let totalInserted = 0;
  let totalIgnored = 0;
  let totalErrors = 0;
  let firstError: string | undefined;

  const insertFn = insertPoiBatch;
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const batchMsg = `--- Batch ${batchNum}/${totalBatches} (lignes ${i}–${i + batch.length - 1}) ---`;
    logger.info('INSERTER', `${batchMsg}`);
    onLog?.('info', batchMsg);

    try {
      const result = await insertFn(batch, i, onLog);
      totalInserted += result.inserted;
      totalIgnored += result.ignored;
      totalErrors += result.errors;
      if (result.firstError && !firstError) firstError = result.firstError;

      const batchSummary = `Batch ${batchNum} termine: +${result.inserted} inseres, ${result.ignored} ignores, ${result.errors} erreurs`;
      logger.info('INSERTER', `${batchSummary}`);
      onLog?.('info', batchSummary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[INSERTER] Erreur fatale batch ${batchNum}: ${msg}`);
      onLog?.('error', `Erreur fatale batch ${batchNum}: ${msg}`);
      if (!firstError) firstError = msg;
      totalErrors += batch.length;
    }

    if (onProgress) {
      onProgress(
        Math.min(i + BATCH_SIZE, rows.length),
        rows.length,
        totalInserted,
        totalIgnored,
        totalErrors
      );
    }
  }

  const endMsg = `====== FIN: inserted=${totalInserted}, ignored=${totalIgnored}, errors=${totalErrors} ======`;
  logger.info('INSERTER', `${endMsg}`);
  onLog?.('info', endMsg);

  // Invalider le cache des catégories pour que les nouvelles catégories soient visibles immédiatement
  if (dataType === 'poi' && totalInserted > 0) {
    invalidateCategoriesCache();

    // Enrichissement automatique région/département pour les POIs importés sans ces données
    const dataSourceIds = [...new Set(rows.map(r => r.data_source_id).filter(Boolean) as string[])];
    for (const dsId of dataSourceIds) {
      enrichMissingGeo(dsId, onLog).catch(err =>
        console.error('[INSERTER] enrichMissingGeo error:', err?.message ?? err)
      );
    }
  }

  if (firstError) {
    const errSummary = `Premiere erreur: ${firstError}`;
    console.error(`[INSERTER] ${errSummary}`);
    onLog?.('error', errSummary);
  }

  return { inserted: totalInserted, ignored: totalIgnored, errors: totalErrors, firstError };
}

/**
 * Close database connection (no-op with Supabase JS client)
 */
export async function closeConnection() {
  // No persistent connection to close with Supabase JS
  logger.info('INSERTER', 'Supabase JS — pas de connexion à fermer');
}
