/**
 * GEO.Prompt — Import Universel — Inserter
 * v4.2.0 — MEGA-LOGS : journal en direct par ligne
 * Chaque INSERT → log OK / SKIP / ERR envoyé au client via callback
 */
import postgres from 'postgres';
import type { ProcessedRow, LogCallback } from './types';

const BATCH_SIZE = 50;

let _sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (_sql) return _sql;
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL ou SUPABASE_DB_URL requis dans .env.local pour l\'import direct');
  }

  // Parse URL manuellement avec regex — new URL() ne gere pas postgresql://
  // Format: postgresql://user:pass@host:port/database
  const match = dbUrl.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/);

  if (match) {
    const [, rawUser, rawPass, host, portStr, database] = match;
    const username = decodeURIComponent(rawUser);
    const password = decodeURIComponent(rawPass);
    const port = parseInt(portStr);

    console.log(`[INSERTER] Connexion DB: ${username}@${host}:${port}/${database}`);

    _sql = postgres({
      host,
      port,
      database,
      username,
      password,
      max: 5,
      idle_timeout: 30,
      connect_timeout: 30,
    });
  } else {
    // Fallback: passer l'URL brute
    console.warn(`[INSERTER] URL non parsee, fallback brut: ${dbUrl.replace(/:([^:@]+)@/, ':***@')}`);
    _sql = postgres(dbUrl, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 30,
    });
  }

  return _sql;
}

// ============================================================
// Schema check — vérifie que les colonnes existent
// ============================================================

interface SchemaInfo {
  hasDataSourceId: boolean;
  hasOrganizationId: boolean;
  allColumns: string[];
}

async function checkTableSchema(tableName: string, onLog?: LogCallback): Promise<SchemaInfo> {
  const sql = getSql();
  const msg = `Schema check: table "${tableName}"...`;
  console.log(`[INSERTER] ${msg}`);
  onLog?.('info', msg);

  try {
    const rows = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
      ORDER BY ordinal_position
    `;

    const cols = rows.map((r) => r.column_name as string);
    const hasDataSourceId = cols.includes('data_source_id');
    const hasOrganizationId = cols.includes('organization_id');

    const colMsg = `"${tableName}": ${cols.length} colonnes | data_source_id: ${hasDataSourceId ? 'OUI' : 'NON'} | organization_id: ${hasOrganizationId ? 'OUI' : 'NON'}`;
    console.log(`[INSERTER] ${colMsg}`);
    onLog?.(hasDataSourceId && hasOrganizationId ? 'info' : 'warn', colMsg);

    if (!hasDataSourceId || !hasOrganizationId) {
      const fix = `Colonnes manquantes! Executer: ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS data_source_id UUID; (+ organization_id)`;
      console.warn(`[INSERTER] ${fix}`);
      onLog?.('warn', fix);
    }

    return { hasDataSourceId, hasOrganizationId, allColumns: cols };
  } catch (err) {
    const errMsg = `Schema check ERREUR: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[INSERTER] ${errMsg}`);
    onLog?.('error', errMsg);
    return { hasDataSourceId: false, hasOrganizationId: false, allColumns: [] };
  }
}

// ============================================================
// POI Insert — poi_france table — LOG CHAQUE LIGNE
// ============================================================

async function insertPoiSingleBatch(
  batch: ProcessedRow[],
  schema: SchemaInfo,
  globalOffset: number,
  onLog?: LogCallback
): Promise<{ inserted: number; ignored: number; errors: number; firstError?: string }> {
  if (batch.length === 0) return { inserted: 0, ignored: 0, errors: 0 };

  const sql = getSql();
  let inserted = 0;
  let ignored = 0;
  let errors = 0;
  let firstError: string | undefined;

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    const rowNum = globalOffset + i;
    const label = r.nom || r.id?.substring(0, 8) || '?';

    try {
      let result;

      if (schema.hasDataSourceId && schema.hasOrganizationId) {
        result = await sql.unsafe(
          `INSERT INTO poi_france (
            id, geom, lat, lng,
            categorie, sous_categorie,
            nom, adresse, ville, code_postal,
            departement, code_departement, region,
            source, date_import, metadata,
            data_source_id, organization_id
          ) VALUES (
            $1::uuid,
            ST_SetSRID(ST_MakePoint($3, $2), 4326),
            $2, $3,
            $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12,
            $13, NOW(), $14::jsonb,
            $15::uuid, $16::uuid
          ) ON CONFLICT DO NOTHING`,
          [
            r.id,
            r.lat,
            r.lng,
            r.categorie || 'autre',
            r.sous_categorie || null,
            r.nom || null,
            r.adresse || null,
            r.ville || null,
            r.code_postal || null,
            r.departement || null,
            r.code_departement || null,
            r.region || null,
            r.source || 'import_universel',
            JSON.stringify(r.metadata || {}),
            r.data_source_id || null,
            r.organization_id || null,
          ]
        );
      } else {
        // Fallback sans data_source_id / organization_id
        result = await sql.unsafe(
          `INSERT INTO poi_france (
            id, geom, lat, lng,
            categorie, sous_categorie,
            nom, adresse, ville, code_postal,
            departement, code_departement, region,
            source, date_import, metadata
          ) VALUES (
            $1::uuid,
            ST_SetSRID(ST_MakePoint($3, $2), 4326),
            $2, $3,
            $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12,
            $13, NOW(), $14::jsonb
          ) ON CONFLICT DO NOTHING`,
          [
            r.id,
            r.lat,
            r.lng,
            r.categorie || 'autre',
            r.sous_categorie || null,
            r.nom || null,
            r.adresse || null,
            r.ville || null,
            r.code_postal || null,
            r.departement || null,
            r.code_departement || null,
            r.region || null,
            r.source || 'import_universel',
            JSON.stringify(r.metadata || {}),
          ]
        );
      }

      if ((result as { count: number }).count > 0) {
        inserted++;
        const okMsg = `[OK] #${rowNum} ${label} (${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}) → insere`;
        console.log(`[INSERTER] ${okMsg}`);
        onLog?.('info', okMsg);
      } else {
        ignored++;
        const skipMsg = `[SKIP] #${rowNum} ${label} → doublon (ON CONFLICT)`;
        console.log(`[INSERTER] ${skipMsg}`);
        onLog?.('warn', skipMsg);
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
// Panneaux Insert — panneaux_affichage table — LOG CHAQUE LIGNE
// ============================================================

async function insertPanneauxSingleBatch(
  batch: ProcessedRow[],
  schema: SchemaInfo,
  globalOffset: number,
  onLog?: LogCallback
): Promise<{ inserted: number; ignored: number; errors: number; firstError?: string }> {
  if (batch.length === 0) return { inserted: 0, ignored: 0, errors: 0 };

  const sql = getSql();
  let inserted = 0;
  let ignored = 0;
  let errors = 0;
  let firstError: string | undefined;

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    const rowNum = globalOffset + i;
    const label = r.reference_panneau || r.id?.substring(0, 8) || '?';

    try {
      let result;

      if (schema.hasDataSourceId && schema.hasOrganizationId) {
        result = await sql.unsafe(
          `INSERT INTO panneaux_affichage (
            id, geom, lat, lng,
            reference_panneau, regie, type_panneau,
            ville, code_postal, code_departement,
            departement, region,
            actif,
            data_source_id, organization_id
          ) VALUES (
            $1::uuid,
            ST_SetSRID(ST_MakePoint($3, $2), 4326),
            $2, $3,
            $4, $5, $6,
            $7, $8, $9,
            $10, $11,
            true,
            $12::uuid, $13::uuid
          ) ON CONFLICT (reference_panneau, regie) DO NOTHING`,
          [
            r.id,
            r.lat,
            r.lng,
            r.reference_panneau || r.id,
            r.regie || 'Inconnu',
            r.type_panneau || null,
            r.ville || null,
            r.code_postal || null,
            r.code_departement || null,
            r.departement || null,
            r.region || null,
            r.data_source_id || null,
            r.organization_id || null,
          ]
        );
      } else {
        result = await sql.unsafe(
          `INSERT INTO panneaux_affichage (
            id, geom, lat, lng,
            reference_panneau, regie, type_panneau,
            ville, code_postal, code_departement,
            departement, region,
            actif
          ) VALUES (
            $1::uuid,
            ST_SetSRID(ST_MakePoint($3, $2), 4326),
            $2, $3,
            $4, $5, $6,
            $7, $8, $9,
            $10, $11,
            true
          ) ON CONFLICT (reference_panneau, regie) DO NOTHING`,
          [
            r.id,
            r.lat,
            r.lng,
            r.reference_panneau || r.id,
            r.regie || 'Inconnu',
            r.type_panneau || null,
            r.ville || null,
            r.code_postal || null,
            r.code_departement || null,
            r.departement || null,
            r.region || null,
          ]
        );
      }

      if ((result as { count: number }).count > 0) {
        inserted++;
        const okMsg = `[OK] #${rowNum} ${label} (${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}) → insere`;
        console.log(`[INSERTER] ${okMsg}`);
        onLog?.('info', okMsg);
      } else {
        ignored++;
        const skipMsg = `[SKIP] #${rowNum} ${label} → doublon`;
        console.log(`[INSERTER] ${skipMsg}`);
        onLog?.('warn', skipMsg);
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

export async function insertRows(
  rows: ProcessedRow[],
  dataType: 'panneaux' | 'poi',
  onProgress?: (processed: number, total: number, inserted: number, ignored: number, errors: number) => void,
  onLog?: LogCallback
): Promise<{ inserted: number; ignored: number; errors: number; firstError?: string }> {

  const startMsg = `====== START: ${rows.length} lignes, type="${dataType}" ======`;
  console.log(`\n[INSERTER] ${startMsg}`);
  onLog?.('info', startMsg);

  // Schema check
  const tableName = dataType === 'panneaux' ? 'panneaux_affichage' : 'poi_france';
  const schema = await checkTableSchema(tableName, onLog);

  // Test connexion
  try {
    const sql = getSql();
    await sql`SELECT 1 as test`;
    const connMsg = `Connexion DB OK`;
    console.log(`[INSERTER] ${connMsg}`);
    onLog?.('info', connMsg);
  } catch (connErr) {
    const connErrMsg = `Connexion DB ECHOUEE: ${connErr instanceof Error ? connErr.message : String(connErr)}`;
    console.error(`[INSERTER] ${connErrMsg}`);
    onLog?.('error', connErrMsg);
    return { inserted: 0, ignored: 0, errors: rows.length, firstError: connErrMsg };
  }

  let totalInserted = 0;
  let totalIgnored = 0;
  let totalErrors = 0;
  let firstError: string | undefined;

  const insertFn = dataType === 'panneaux' ? insertPanneauxSingleBatch : insertPoiSingleBatch;
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const batchMsg = `--- Batch ${batchNum}/${totalBatches} (lignes ${i}–${i + batch.length - 1}) ---`;
    console.log(`[INSERTER] ${batchMsg}`);
    onLog?.('info', batchMsg);

    try {
      const result = await insertFn(batch, schema, i, onLog);
      totalInserted += result.inserted;
      totalIgnored += result.ignored;
      totalErrors += result.errors;
      if (result.firstError && !firstError) firstError = result.firstError;

      const batchSummary = `Batch ${batchNum} termine: +${result.inserted} inseres, ${result.ignored} ignores, ${result.errors} erreurs`;
      console.log(`[INSERTER] ${batchSummary}`);
      onLog?.('info', batchSummary);
    } catch (err) {
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
  console.log(`[INSERTER] ${endMsg}`);
  onLog?.('info', endMsg);

  if (firstError) {
    const errSummary = `Premiere erreur: ${firstError}`;
    console.error(`[INSERTER] ${errSummary}`);
    onLog?.('error', errSummary);
  }

  return { inserted: totalInserted, ignored: totalIgnored, errors: totalErrors, firstError };
}

/**
 * Close database connection
 */
export async function closeConnection() {
  if (_sql) {
    console.log('[INSERTER] Fermeture connexion DB...');
    await _sql.end();
    _sql = null;
  }
}
