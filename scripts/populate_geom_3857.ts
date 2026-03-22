/**
 * scripts/populate_geom_3857.ts
 *
 * Peuple la colonne geom_3857 dans carreaux_filosofi par lots de 10 000 lignes.
 * L'UPDATE global de 2,3M lignes timeout via l'API Supabase REST — ce script
 * utilise une connexion PostgreSQL directe (DATABASE_URL dans .env.local).
 *
 * Usage :
 *   npx tsx scripts/populate_geom_3857.ts
 *
 * Prérequis :
 *   npm install pg @types/pg tsx dotenv --save-dev
 *
 * Variables d'environnement (au moins une requise) :
 *   DATABASE_URL       — connexion directe Supabase (mode Session, port 5432)
 *   SUPABASE_DB_URL    — alias (même format)
 *   POSTGRES_URL       — alias (même format)
 */

import { Pool } from 'pg';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL;

if (!DATABASE_URL) {
  console.error('Aucune variable DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL trouvée dans .env.local');
  process.exit(1);
}

const BATCH_SIZE = 10_000;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  statement_timeout: 300_000, // 5 min par batch — évite les timeouts long
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  console.log('Connecté à PostgreSQL');

  try {
    // Total à traiter
    const { rows: [{ total }] } = await client.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM carreaux_filosofi WHERE geom_3857 IS NULL`
    );
    const totalNum = parseInt(total, 10);
    console.log(`Lignes à mettre à jour : ${totalNum.toLocaleString()}`);

    if (totalNum === 0) {
      console.log('Rien à faire — geom_3857 déjà peuplé.');
      return;
    }

    let updated = 0;
    let batch = 0;
    const start = Date.now();

    while (true) {
      const result = await client.query(`
        WITH batch AS (
          SELECT id FROM carreaux_filosofi
          WHERE geom_3857 IS NULL
          LIMIT $1
        )
        UPDATE carreaux_filosofi c
          SET geom_3857 = ST_Transform(ST_SetSRID(geom, 4326), 3857)
        FROM batch b
        WHERE c.id = b.id
      `, [BATCH_SIZE]);

      const affected = result.rowCount ?? 0;
      if (affected === 0) break;

      updated += affected;
      batch++;
      const elapsedMs = Date.now() - start;
      const elapsed = (elapsedMs / 1000).toFixed(0);
      const pct = ((updated / totalNum) * 100).toFixed(1);
      const rate = Math.round(updated / (elapsedMs / 1000));
      const eta = rate > 0 ? Math.round((totalNum - updated) / rate) : '?';
      console.log(
        `Batch ${batch}: +${affected.toLocaleString()} | ` +
        `${updated.toLocaleString()}/${totalNum.toLocaleString()} (${pct}%) | ` +
        `${elapsed}s écoulé | ETA ~${eta}s | ${rate.toLocaleString()} lignes/s`
      );
    }

    console.log(`\nMise à jour terminée. ${updated.toLocaleString()} lignes traitées.`);

    // Index GiST
    console.log('\nCréation index GiST sur geom_3857 (peut prendre 2-5 min)...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_geom_3857
        ON carreaux_filosofi USING GIST (geom_3857)
    `);
    console.log('Index créé.');

    // ANALYZE pour que le planner use l'index
    console.log('\nANALYZE carreaux_filosofi...');
    await client.query(`ANALYZE carreaux_filosofi`);
    console.log('ANALYZE terminé.');

    // Vérification
    const { rows: [{ populated, total: tot }] } = await client.query<{ populated: string; total: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE geom_3857 IS NOT NULL) AS populated,
        COUNT(*) AS total
      FROM carreaux_filosofi
      WHERE resolution = '200m'
    `);
    console.log(`\nVérification 200m : ${parseInt(populated, 10).toLocaleString()} / ${parseInt(tot, 10).toLocaleString()} lignes avec geom_3857`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Erreur :', err);
  process.exit(1);
});
