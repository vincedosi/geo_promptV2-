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

/** Construit la ligne a inserer. Peut lever : `metadata` peut etre du JSON invalide. */
function construireLigne(r: ProcessedRow) {
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
  return row;
}

const etiquette = (r: ProcessedRow) => r.nom || r.id?.substring(0, 8) || '?';

/**
 * Repli ligne a ligne — le comportement historique, a l'identique.
 *
 * C'est lui qui produit le diagnostic precis : quelle ligne a echoue, et
 * pourquoi. On ne l'appelle que si l'insertion groupee a echoue.
 */
async function insererLigneAligne(
  batch: ProcessedRow[],
  globalOffset: number,
  onLog?: LogCallback,
): Promise<{ inserted: number; ignored: number; errors: number; firstError?: string }> {
  const supabase = getSupabase();
  let inserted = 0, ignored = 0, errors = 0;
  let firstError: string | undefined;

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    const rowNum = globalOffset + i;
    const label = etiquette(r);
    try {
      const { data, error: insertErr } = await supabase
        .from('poi_france')
        .upsert(construireLigne(r), { onConflict: 'id', ignoreDuplicates: true })
        .select('id');

      if (insertErr) {
        if (insertErr.code === '23505') {
          ignored++;
          onLog?.('warn', `[SKIP] #${rowNum} ${label} → doublon`);
        } else {
          throw new Error(insertErr.message);
        }
      } else if (!data || data.length === 0) {
        // `ON CONFLICT DO NOTHING` n'a rien ecrit : la ligne etait deja en base.
        // Sans le `.select('id')`, ce cas serait indiscernable d'une insertion.
        ignored++;
        onLog?.('warn', `[SKIP] #${rowNum} ${label} → doublon`);
      } else {
        inserted++;
        onLog?.('info', `[OK] #${rowNum} ${label} (${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}) → insere`);
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

/**
 * Insere un lot de POI.
 *
 * ── Ce qui a change le 2026-09-11 (`PERF-002`) ──────────────────────────────
 *
 * Cette fonction faisait UN aller-retour reseau PAR LIGNE — 50 requetes par
 * lot de 50. Sur le compute Nano (250 IOPS), c'est un facteur 50 sur le nombre
 * d'operations. Et `CLAUDE.md` designe ce fichier comme LE patron de « batch
 * par 50 » a copier : le defaut se propageait a chaque nouvel import ecrit sur
 * ce modele.
 *
 * La boucle n'etait pas gratuite pour autant : elle produit un rapport d'erreur
 * ligne par ligne — quelle ligne a echoue, et pourquoi. Une insertion groupee,
 * elle, echoue en bloc sans rien dire.
 *
 * D'ou la strategie : **on tente le groupe, et on ne retombe ligne a ligne
 * qu'en cas d'echec**. Le cas nominal passe a UNE requete ; le cas degrade
 * conserve exactement le diagnostic d'avant.
 *
 * Subtilite a connaitre : avec `ignoreDuplicates: true`, PostgREST emet un
 * `ON CONFLICT (id) DO NOTHING` — un doublon sur `id` ne leve donc AUCUNE
 * erreur, ni en groupe ni ligne a ligne.
 *
 * ── Pourquoi `.select('id')` (2026-09-11, suite d'`ECH-001`) ────────────────
 *
 * Tant que `id` etait un `randomUUID()`, aucun conflit n'etait possible : tout
 * ce qu'on envoyait etait ecrit, et compter `inserted = batch.length` disait
 * vrai. Depuis que l'identite est deterministe
 * (`lib/import/identite-poi.ts`), un rejeu n'ecrit RIEN — et ce compteur
 * annoncerait « 1 200 POI importes » sur un import qui n'en a cree aucun.
 *
 * `.select('id')` fait renvoyer par PostgREST les seules lignes reellement
 * ecrites. On en deduit `inserted` et `ignored` exacts. Le cout est d'un UUID
 * par ligne ecrite sur le retour — negligeable — et c'est le prix de la regle
 * du projet : un import annonce des compteurs vrais, jamais estimes.
 */
async function insertPoiBatch(
  batch: ProcessedRow[],
  globalOffset: number,
  onLog?: LogCallback
): Promise<{ inserted: number; ignored: number; errors: number; firstError?: string }> {
  if (batch.length === 0) return { inserted: 0, ignored: 0, errors: 0 };

  // La construction des lignes peut lever (JSON `metadata` invalide). Si une
  // seule ligne du lot est malformee, on part directement en ligne a ligne :
  // c'est le seul chemin capable de designer la ligne fautive.
  let lignes: ReturnType<typeof construireLigne>[];
  try {
    lignes = batch.map(construireLigne);
  } catch {
    return insererLigneAligne(batch, globalOffset, onLog);
  }

  const supabase = getSupabase();
  // Le `.select('id')` n'est pas cosmetique : avec `ON CONFLICT DO NOTHING`,
  // PostgREST ne renvoie QUE les lignes reellement ecrites. C'est le seul moyen
  // de distinguer « insere » de « deja present ». Voir le bloc ci-dessus.
  const { data, error } = await supabase
    .from('poi_france')
    .upsert(lignes, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');

  if (error) {
    // Le groupe a echoue : on ne sait pas QUELLE ligne pose probleme. Seul le
    // passage ligne a ligne le dira — c'est exactement ce que faisait le code
    // d'avant, et c'est ce que le rapport d'import attend.
    return insererLigneAligne(batch, globalOffset, onLog);
  }

  // Journal ligne par ligne, comme avant — mais chaque ligne dit desormais si
  // elle a ete ecrite ou retrouvee. Un rejeu affiche 50 [SKIP], pas 50 [OK].
  const ecrites = new Set((data ?? []).map((l) => l.id));
  let inserted = 0;
  let ignored = 0;
  batch.forEach((r, i) => {
    const rowNum = globalOffset + i;
    const label = etiquette(r);
    if (ecrites.has(r.id)) {
      inserted++;
      onLog?.('info', `[OK] #${rowNum} ${label} (${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}) → insere`);
    } else {
      ignored++;
      onLog?.('warn', `[SKIP] #${rowNum} ${label} → doublon`);
    }
  });
  return { inserted, ignored, errors: 0 };
}

// ============================================================
// Main dispatcher with progress + live logs
// ============================================================
// NB : le type 'panneaux' a été retiré avec la page /integration-panneaux
// (2026-07-02). L'import ArcGIS (/admin/ooh-import) est supprimé depuis le 2026-10-16 :
// plus aucun import de panneaux depuis l'interface (spec 2026-10-16-ooh-campagnes).

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
