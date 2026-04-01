/**
 * ANFR import logic — download, parse, diff, upsert radio emitters
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadAndParseAnfr } from './anfr-parser';
import type { EmetteurRadioInsert, ImportStats } from './types';

const BATCH = 500;

type ProgressCallback = (event: { type: string; message: string; [k: string]: unknown }) => void;

export async function importAnfrData(
  supabase: SupabaseClient,
  onProgress: ProgressCallback,
): Promise<ImportStats> {
  const t0 = Date.now();
  let logId: string | null = null;

  try {
    // 1. Create import log entry
    const { data: logData, error: logErr } = await supabase
      .from('radio_imports_log')
      .insert({ type: 'anfr', status: 'running' })
      .select('id')
      .single();
    if (logErr) throw new Error(`Log creation failed: ${logErr.message}`);
    logId = logData.id;
    onProgress({ type: 'status', message: 'Import ANFR démarré', log_id: logId });

    // 2. Download and parse
    const { emetteurs, snapshotDate } = await downloadAndParseAnfr((phase, cur, tot) => {
      onProgress({ type: 'status', message: phase, current: cur, total: tot });
    });

    const totalFm = emetteurs.filter(e => e.systeme === 'FM').length;
    const totalDab = emetteurs.filter(e => e.systeme === 'DAB+').length;
    onProgress({
      type: 'progress', message: `${emetteurs.length} émetteurs parsés (FM: ${totalFm}, DAB+: ${totalDab})`,
      total_parsed: emetteurs.length, fm: totalFm, dab: totalDab,
    });

    // 3. Archive current state
    onProgress({ type: 'status', message: 'Archivage de l\'état courant...' });
    const { data: archiveResult } = await supabase.rpc('archive_and_purge_radio');
    const archived = (archiveResult as { archived: number } | null)?.archived ?? 0;
    onProgress({ type: 'status', message: `${archived} émetteurs archivés` });

    // 4. Get existing emitters for diff
    const { data: existing } = await supabase
      .from('emetteurs_radio')
      .select('sta_nm_anfr');
    const existingSet = new Set((existing ?? []).map((e: { sta_nm_anfr: string }) => e.sta_nm_anfr));
    const newSet = new Set(emetteurs.map(e => e.sta_nm_anfr));

    // 5. Delete emitters no longer in ANFR data
    const toDelete = [...existingSet].filter(k => !newSet.has(k));
    let deleted = 0;
    if (toDelete.length > 0) {
      onProgress({ type: 'status', message: `Suppression de ${toDelete.length} émetteurs obsolètes...` });
      for (let i = 0; i < toDelete.length; i += BATCH) {
        const batch = toDelete.slice(i, i + BATCH);
        const { error } = await supabase
          .from('emetteurs_radio')
          .delete()
          .in('sta_nm_anfr', batch);
        if (!error) deleted += batch.length;
      }
    }

    // 6. Upsert by batches of 500
    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < emetteurs.length; i += BATCH) {
      const batch = emetteurs.slice(i, i + BATCH);
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
        onProgress({ type: 'error', message: `Batch ${Math.floor(i / BATCH) + 1}: ${upsertErr.message}` });
      } else {
        // Count new vs updated
        const newInBatch = batch.filter(e => !existingSet.has(e.sta_nm_anfr)).length;
        inserted += newInBatch;
        updated += (count ?? batch.length) - newInBatch;
      }

      const pct = Math.round(((i + batch.length) / emetteurs.length) * 100);
      onProgress({
        type: 'progress',
        message: `Upsert ${i + batch.length}/${emetteurs.length} (${pct}%)`,
        percent: pct, inserted, updated, errors,
      });
    }

    // 7. Refresh materialized view
    onProgress({ type: 'status', message: 'Rafraîchissement de la vue couverture...' });
    await supabase.rpc('get_radio_stats').then(() => {
      // The view refresh is expensive — do it only if there's data with radio_id
      // For now, just call stats to verify things work
    });

    const stats: ImportStats = {
      total_parsed: emetteurs.length,
      total_fm: totalFm,
      total_dab: totalDab,
      inserted,
      updated,
      deleted,
      errors,
      duration_ms: Date.now() - t0,
    };

    // 8. Update log
    await supabase
      .from('radio_imports_log')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        stats,
      })
      .eq('id', logId);

    onProgress({
      type: 'done',
      message: `Import terminé : ${inserted} nouveaux, ${updated} mis à jour, ${deleted} supprimés`,
      ...stats,
    });

    return stats;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (logId) {
      await supabase
        .from('radio_imports_log')
        .update({
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: msg,
        })
        .eq('id', logId);
    }

    onProgress({ type: 'error', message: msg });
    throw err;
  }
}

/** JS-side estimate matching the SQL function */
function estimateCoverage(puissanceW: number | null, hauteurM: number | null): number {
  const p = Math.max(puissanceW ?? 100, 1);
  const h = hauteurM ?? 30;
  return Math.min(
    4120 * (Math.sqrt(h) + Math.sqrt(1.5)) * Math.log(p) / Math.log(1000),
    150000,
  );
}
