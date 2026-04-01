/**
 * ANFR import logic — download, parse, diff, upsert radio emitters
 * Instrumented with ImportLogger for granular phase-by-phase logging.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadAndParseAnfr } from './anfr-parser';
import { ImportLogger } from './import-logger';
import type { ImportStats } from './types';

const BATCH = 500;

type ProgressCallback = (event: Record<string, unknown>) => void;

export async function importAnfrData(
  supabase: SupabaseClient,
  onProgress: ProgressCallback,
): Promise<ImportStats> {
  const t0 = Date.now();

  // ── Phase INIT: create log entry ──────────────────────────────────────────
  const { data: logData, error: logErr } = await supabase
    .from('radio_imports_log')
    .insert({ type: 'anfr', status: 'running' })
    .select('id')
    .single();
  if (logErr) throw new Error(`Log creation failed: ${logErr.message}`);
  const logId = logData.id;

  const logger = new ImportLogger(supabase, logId, onProgress);
  await logger.info('INIT', 'Import ANFR démarré', { log_id: logId });

  let inserted = 0, updated = 0, deleted = 0, errors = 0;
  let totalFm = 0, totalDab = 0;
  let emetteurCount = 0;

  try {
    // ── Phase DOWNLOAD + EXTRACT + PARSE ────────────────────────────────────
    const { emetteurs, snapshotDate } = await logger.phase('DOWNLOAD', async () => {
      const result = await downloadAndParseAnfr((phase, cur, tot) => {
        logger.info('DOWNLOAD', phase, { current: cur, total: tot });
      });
      await logger.info('DOWNLOAD', `Version fichier : ${result.snapshotDate}`);
      return result;
    });

    emetteurCount = emetteurs.length;
    totalFm = emetteurs.filter(e => e.systeme === 'FM').length;
    totalDab = emetteurs.filter(e => e.systeme === 'DAB+').length;

    await logger.info('PARSE', `${emetteurs.length} émetteurs radio extraits`, {
      total: emetteurs.length, fm: totalFm, dab: totalDab, snapshot: snapshotDate,
    });

    const noCoords = emetteurs.filter(e => !e.lat || !e.lon).length;
    if (noCoords > 0) {
      await logger.warn('PARSE', `${noCoords} émetteurs sans coordonnées GPS (ignorés)`);
    }

    // ── Phase ARCHIVE ───────────────────────────────────────────────────────
    await logger.phase('ARCHIVE', async () => {
      const { data: archiveResult } = await supabase.rpc('archive_and_purge_radio');
      const ar = archiveResult as { archived: number; purged: number } | null;
      await logger.info('ARCHIVE', `${ar?.archived ?? 0} émetteurs archivés, ${ar?.purged ?? 0} archives > 12 mois purgées`);
    });

    // ── Phase DIFF ──────────────────────────────────────────────────────────
    const { existingSet, toDelete } = await logger.phase('DIFF', async () => {
      // Paginate to avoid PostgREST 5000 row limit
      const allExisting: string[] = [];
      let off = 0;
      while (true) {
        const { data } = await supabase.from('emetteurs_radio').select('sta_nm_anfr').range(off, off + 4999);
        if (!data || data.length === 0) break;
        allExisting.push(...data.map((e: { sta_nm_anfr: string }) => e.sta_nm_anfr));
        if (data.length < 5000) break;
        off += 5000;
      }
      const existingSet = new Set(allExisting);
      const newSet = new Set(emetteurs.map(e => e.sta_nm_anfr));
      const toDelete = [...existingSet].filter(k => !newSet.has(k));
      const newCount = emetteurs.filter(e => !existingSet.has(e.sta_nm_anfr)).length;
      const unchangedCount = emetteurs.filter(e => existingSet.has(e.sta_nm_anfr)).length;

      await logger.info('DIFF', `Nouveaux : ${newCount}, Existants : ${unchangedCount}, À supprimer : ${toDelete.length}`, {
        new: newCount, existing: unchangedCount, to_delete: toDelete.length,
      });
      return { existingSet, toDelete };
    });

    // ── Phase DELETE ─────────────────────────────────────────────────────────
    if (toDelete.length > 0) {
      await logger.phase('DELETE', async () => {
        for (let i = 0; i < toDelete.length; i += BATCH) {
          const batch = toDelete.slice(i, i + BATCH);
          const { error } = await supabase
            .from('emetteurs_radio')
            .delete()
            .in('sta_nm_anfr', batch);
          if (!error) deleted += batch.length;
        }
        await logger.info('DELETE', `${deleted} émetteurs obsolètes supprimés`);
      });
    }

    // ── Phase UPSERT ────────────────────────────────────────────────────────
    await logger.phase('UPSERT', async () => {
      const totalBatches = Math.ceil(emetteurs.length / BATCH);
      for (let i = 0; i < emetteurs.length; i += BATCH) {
        const batch = emetteurs.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const rows = batch.map(e => ({
          sta_nm_anfr: e.sta_nm_anfr,
          systeme: e.systeme,
          frequence_mhz: e.frequence_mhz,
          puissance_w: e.puissance_w,
          hauteur_m: e.hauteur_m,
          exploitant: e.exploitant,
          adresse: e.adresse,
          commune: e.commune,
          departement: e.departement,
          geom: `SRID=4326;POINT(${e.lon} ${e.lat})`,
          rayon_couverture_m: estimateCoverage(e.puissance_w, e.hauteur_m),
          snapshot_date: e.snapshot_date,
        }));

        const { error: upsertErr, count } = await supabase
          .from('emetteurs_radio')
          .upsert(rows, { onConflict: 'sta_nm_anfr' });

        if (upsertErr) {
          errors += batch.length;
          await logger.error('UPSERT', `Batch ${batchNum}/${totalBatches} échoué : ${upsertErr.message}`);
        } else {
          const newInBatch = batch.filter(e => !existingSet.has(e.sta_nm_anfr)).length;
          inserted += newInBatch;
          updated += (count ?? batch.length) - newInBatch;
        }

        const pct = Math.round(((i + batch.length) / emetteurs.length) * 100);
        onProgress({ type: 'progress', message: `Upsert ${i + batch.length}/${emetteurs.length} (${pct}%)`, percent: pct, inserted, updated, errors });
      }
      await logger.info('UPSERT', `${inserted} insérés, ${updated} mis à jour, ${errors} erreurs`);
    });

    // ── Phase REFRESH_VIEW ──────────────────────────────────────────────────
    await logger.phase('REFRESH_VIEW', async () => {
      await supabase.rpc('get_radio_stats');
      await logger.info('REFRESH_VIEW', 'Stats radio recalculées');
    });

    // ── Phase FINALIZE ──────────────────────────────────────────────────────
    const stats: ImportStats = {
      total_parsed: emetteurCount,
      total_fm: totalFm,
      total_dab: totalDab,
      inserted,
      updated,
      deleted,
      errors,
      duration_ms: Date.now() - t0,
    };

    await supabase
      .from('radio_imports_log')
      .update({ status: 'success', completed_at: new Date().toISOString(), stats })
      .eq('id', logId);

    await logger.success('FINALIZE', `Import ANFR terminé : ${emetteurCount} émetteurs (${totalFm} FM, ${totalDab} DAB+), ${inserted} nouveaux, ${updated} modifiés, ${deleted} supprimés`, stats as unknown as Record<string, unknown>, Date.now() - t0);

    return stats;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await logger.error('FATAL', `Import ANFR avorté : ${msg}`, { stack });

    await supabase
      .from('radio_imports_log')
      .update({ status: 'error', completed_at: new Date().toISOString(), error_message: msg })
      .eq('id', logId);

    throw err;
  }
}

function estimateCoverage(puissanceW: number | null, hauteurM: number | null): number {
  const p = Math.max(puissanceW ?? 100, 1);
  const h = hauteurM ?? 30;
  return Math.min(4120 * (Math.sqrt(h) + Math.sqrt(1.5)) * Math.log(p) / Math.log(1000), 150000);
}
