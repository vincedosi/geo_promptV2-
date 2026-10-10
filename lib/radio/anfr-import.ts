/**
 * ANFR import logic — download, parse, diff, upsert radio emitters
 * Instrumented with ImportLogger for granular phase-by-phase logging.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadAndParseAnfr } from './anfr-parser';
import { ImportLogger } from './import-logger';
import type { ImportStats } from './types';
import { lireTout } from '@/lib/supabase/lire-tout';
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';

const BATCH = 500;

/** Borne de la lecture des émetteurs en base (12 704 le 2026-10-10) : au-delà, l'import échoue au lieu de tronquer. */
const PLAFOND_EMETTEURS = 100_000;

/**
 * Part maximale des émetteurs existants que l'import peut supprimer (décision
 * du 2026-10-10). Au-delà, la phase DELETE est annulée en entier : un fichier
 * ANFR complet retire quelques dizaines d'émetteurs, pas des milliers.
 */
const SEUIL_SUPPRESSION = 0.05;

/** Au-delà de cette part, le fichier est manifestement tronqué : annulation sans même lire les liaisons. */
const SEUIL_TRONCATURE_MANIFESTE = 0.5;

/** Ids par requête `.in()` (UUID de 36 caractères : l'URL reste courte). */
const LOT_SUPPRESSION = 100;

/** Émetteurs conservés nommés dans le message ; la liste complète va dans les détails du journal. */
const LISTE_MAX = 50;

/** Borne de lecture des liaisons d'un lot d'émetteurs (moyenne : 48 par émetteur lié). */
const PLAFOND_LIAISONS_LOT = 200_000;

function messageAnnulation(aSupprimer: number, existants: number): string {
  const part = existants > 0 ? (aSupprimer / existants) * 100 : 100;
  return `Suppression annulée : ${formaterNombre(aSupprimer)} émetteurs à supprimer sur `
    + `${formaterNombre(existants)} (${formaterDecimal(part, 1)} %), au-delà du garde-fou de `
    + `${formaterNombre(SEUIL_SUPPRESSION * 100)} %. Fichier ANFR probablement tronqué : `
    + `aucun émetteur n'a été supprimé.`;
}

/**
 * Radios liées à chacun des émetteurs donnés : `{ emetteur_id → radios }`.
 * Lecture paginée par lots d'ids (un émetteur peut porter plus de 1 000
 * liaisons, plafond `db-max-rows`).
 */
async function radiosDesEmetteurs(supabase: SupabaseClient, ids: string[]): Promise<Map<string, Set<string>>> {
  const radios = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += LOT_SUPPRESSION) {
    const lot = ids.slice(i, i + LOT_SUPPRESSION);
    const { lignes } = await lireTout<{ emetteur_id: string; radio_id: string }>(
      (de, a) => supabase
        .from('emetteur_radio_stations')
        .select('emetteur_id, radio_id')
        .in('emetteur_id', lot)
        .order('id')
        .range(de, a),
      PLAFOND_LIAISONS_LOT,
    );
    for (const l of lignes) {
      if (!radios.has(l.emetteur_id)) radios.set(l.emetteur_id, new Set());
      radios.get(l.emetteur_id)!.add(l.radio_id);
    }
  }
  return radios;
}

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
  let deleteErrors = 0, retainedLinked = 0;
  let deleteAborted = false;
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
      // Lecture PAGINÉE de tous les émetteurs en base. L'ancienne boucle
      // paginait par 5 000 et s'arrêtait sur une page de moins de 5 000 ; or
      // PostgREST coupe toute requête de table à `db-max-rows` = 1 000 : elle
      // s'arrêtait donc APRÈS LA PREMIÈRE PAGE, et 11 704 des 12 704 émetteurs
      // (2026-10-10) échappaient au diff — jamais supprimés, comptés nouveaux.
      // `lireTout` pagine sous le plafond et échoue au-delà de sa borne ;
      // `order('sta_nm_anfr')` (clé unique) : deux pages ne se recouvrent pas.
      const { lignes } = await lireTout<{ id: string; sta_nm_anfr: string }>(
        (de, a) => supabase.from('emetteurs_radio').select('id, sta_nm_anfr').order('sta_nm_anfr').range(de, a),
        PLAFOND_EMETTEURS,
      );
      const existingSet = new Set(lignes.map((e) => e.sta_nm_anfr));
      const newSet = new Set(emetteurs.map(e => e.sta_nm_anfr));
      const toDelete = lignes.filter((e) => !newSet.has(e.sta_nm_anfr));
      const newCount = emetteurs.filter(e => !existingSet.has(e.sta_nm_anfr)).length;
      const unchangedCount = emetteurs.filter(e => existingSet.has(e.sta_nm_anfr)).length;

      await logger.info('DIFF', `Nouveaux : ${newCount}, Existants : ${unchangedCount}, À supprimer : ${toDelete.length}`, {
        new: newCount, existing: unchangedCount, to_delete: toDelete.length,
      });
      return { existingSet, toDelete };
    });

    // ── Garde-fous avant toute suppression ──────────────────────────────────
    // `emetteur_radio_stations.emetteur_id` est `ON DELETE CASCADE` : supprimer
    // un émetteur emporte ses liaisons radio, et les 569 698 liaisons rapatriées
    // du projet hébergé supprimé sont IRREMPLAÇABLES. Décision du 2026-10-10 :
    //   1. un émetteur lié à au moins une radio n'est JAMAIS supprimé ici ;
    //   2. si les suppressions restantes dépassent SEUIL_SUPPRESSION des
    //      émetteurs existants, la phase DELETE est annulée en entier.
    const totalExistants = existingSet.size;
    let aSupprimer = toDelete;
    if (toDelete.length > 0 && toDelete.length > totalExistants * SEUIL_TRONCATURE_MANIFESTE) {
      // Plus de la moitié de la base à retirer : le fichier est tronqué, inutile
      // de lire des dizaines de milliers de liaisons pour le constater (budget I/O).
      deleteAborted = true;
      aSupprimer = [];
      await logger.warn('DELETE', messageAnnulation(toDelete.length, totalExistants), {
        to_delete: toDelete.length, existing: totalExistants,
      });
    } else if (toDelete.length > 0) {
      const lies = await logger.phase('LIAISONS', async () => {
        const radiosParEmetteur = await radiosDesEmetteurs(supabase, toDelete.map((e) => e.id));
        const conserves = toDelete
          .filter((e) => radiosParEmetteur.has(e.id))
          .map((e) => ({ sta_nm_anfr: e.sta_nm_anfr, nb_radios: radiosParEmetteur.get(e.id)!.size }));
        if (conserves.length > 0) {
          const liste = conserves.slice(0, LISTE_MAX)
            .map((c) => `${c.sta_nm_anfr} (${c.nb_radios} radio${c.nb_radios > 1 ? 's' : ''})`)
            .join(', ');
          const suite = conserves.length > LISTE_MAX ? `, et ${formaterNombre(conserves.length - LISTE_MAX)} autres` : '';
          await logger.warn(
            'LIAISONS',
            `${formaterNombre(conserves.length)} émetteurs retirés de l'ANFR, conservés car liés à des radios : ${liste}${suite}`,
            { conserves },
          );
        } else {
          await logger.info('LIAISONS', 'Aucun émetteur à retirer n\'est lié à une radio');
        }
        return new Set(conserves.map((c) => c.sta_nm_anfr));
      });
      retainedLinked = lies.size;
      aSupprimer = toDelete.filter((e) => !lies.has(e.sta_nm_anfr));

      if (aSupprimer.length > totalExistants * SEUIL_SUPPRESSION) {
        deleteAborted = true;
        await logger.warn('DELETE', messageAnnulation(aSupprimer.length, totalExistants), {
          to_delete: aSupprimer.length, existing: totalExistants, retained_linked: retainedLinked,
        });
        aSupprimer = [];
      }
    }

    // ── Phase DELETE ─────────────────────────────────────────────────────────
    if (aSupprimer.length > 0) {
      await logger.phase('DELETE', async () => {
        const ids = aSupprimer.map((e) => e.id);
        const totalLots = Math.ceil(ids.length / LOT_SUPPRESSION);
        for (let i = 0; i < ids.length; i += LOT_SUPPRESSION) {
          const lot = ids.slice(i, i + LOT_SUPPRESSION);
          const numero = Math.floor(i / LOT_SUPPRESSION) + 1;
          // `count: 'exact'` : sans lui `count` vaut null, et le bilan
          // annoncerait la taille du lot au lieu des lignes supprimées.
          const { error, count } = await supabase
            .from('emetteurs_radio')
            .delete({ count: 'exact' })
            .in('id', lot);
          if (error) {
            deleteErrors += lot.length;
            await logger.error('DELETE', `Lot ${numero}/${totalLots} : suppression échouée : ${error.message}`, {
              lot: numero, taille: lot.length,
            });
          } else {
            deleted += count ?? 0;
          }
          onProgress({
            type: 'progress',
            message: `Suppression ${Math.min(i + lot.length, ids.length)}/${ids.length}`,
            percent: Math.round((Math.min(i + lot.length, ids.length) / ids.length) * 100),
            deleted,
          });
        }
        await logger.info(
          'DELETE',
          `${formaterNombre(deleted)} émetteurs obsolètes supprimés`
            + (deleteErrors > 0 ? `, ${formaterNombre(deleteErrors)} en échec` : ''),
        );
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
      delete_errors: deleteErrors,
      retained_linked: retainedLinked,
      delete_aborted: deleteAborted,
      duration_ms: Date.now() - t0,
    };

    await supabase
      .from('radio_imports_log')
      .update({ status: 'success', completed_at: new Date().toISOString(), stats })
      .eq('id', logId);

    await logger.success('FINALIZE', `Import ANFR terminé : ${emetteurCount} émetteurs (${totalFm} FM, ${totalDab} DAB+), ${inserted} nouveaux, ${updated} modifiés, ${deleted} supprimés`
      + (retainedLinked > 0 ? `, ${retainedLinked} retirés de l'ANFR mais conservés car liés à des radios` : '')
      + (deleteAborted ? ', suppression ANNULÉE par le garde-fou (fichier probablement tronqué)' : '')
      + (deleteErrors > 0 ? `, ${deleteErrors} suppressions en échec` : ''), stats as unknown as Record<string, unknown>, Date.now() - t0);

    return stats;

  } catch (err: unknown) {
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
