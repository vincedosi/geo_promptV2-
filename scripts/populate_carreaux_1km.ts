/**
 * scripts/populate_carreaux_1km.ts
 *
 * Peuple la table carreaux_1km (agrégation 200m → 1km²).
 * La requête GROUP BY sur 2,3M lignes est trop lente pour l'API REST Supabase
 * (timeout 30s) — ce script utilise une connexion PostgreSQL directe.
 *
 * Usage :
 *   npx tsx scripts/populate_carreaux_1km.ts
 *
 * Prérequis :
 *   - Migration 044_carreaux_1km_schema appliquée (table vide créée)
 *   - npm install pg @types/pg tsx dotenv --save-dev
 *
 * Variables d'environnement (.env.local) :
 *   DATABASE_URL    — connexion directe Supabase (mode Session, port 5432)
 *   SUPABASE_DB_URL — alias
 *   POSTGRES_URL    — alias
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

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  statement_timeout: 600_000, // 10 min — largement suffisant pour le GROUP BY
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  console.log('Connecté à PostgreSQL');

  try {
    // Vérifier que la table existe
    const { rows: [tableCheck] } = await client.query(
      `SELECT to_regclass('public.carreaux_1km') AS exists`
    );
    if (!tableCheck.exists) {
      console.error('Table carreaux_1km introuvable — exécuter la migration 044_carreaux_1km_schema d\'abord');
      process.exit(1);
    }

    // Vérifier si déjà peuplé
    const { rows: [{ current }] } = await client.query<{ current: string }>(
      `SELECT COUNT(*) AS current FROM carreaux_1km`
    );
    if (parseInt(current, 10) > 0) {
      console.log(`Table déjà peuplée : ${parseInt(current, 10).toLocaleString()} mailles. Vidage...`);
      await client.query(`TRUNCATE carreaux_1km`);
    }

    const { rows: [{ source }] } = await client.query<{ source: string }>(
      `SELECT COUNT(*) AS source FROM carreaux_filosofi WHERE resolution = '200m' AND geom_3857 IS NOT NULL`
    );
    console.log(`Source : ${parseInt(source, 10).toLocaleString()} carreaux 200m à agréger en mailles 1km`);
    console.log('Agrégation en cours... (peut prendre 2-5 min)');

    const t0 = Date.now();

    await client.query(`
      INSERT INTO carreaux_1km
      SELECT
        ST_Expand(ST_SnapToGrid(ST_Centroid(geom_3857), 1000), 500)::geometry(Polygon, 3857) AS geom_3857,
        SUM(COALESCE((metadata->>'ind')::numeric,       0))::integer AS population_totale,
        SUM(COALESCE((metadata->>'ind_inc')::numeric,   0))::integer AS population_inconnue,
        SUM(COALESCE((metadata->>'ind_0_3')::numeric,   0))::integer AS ind_0_3,
        SUM(COALESCE((metadata->>'ind_4_5')::numeric,   0))::integer AS ind_4_5,
        SUM(COALESCE((metadata->>'ind_6_10')::numeric,  0))::integer AS ind_6_10,
        SUM(COALESCE((metadata->>'ind_11_17')::numeric, 0))::integer AS ind_11_17,
        SUM(COALESCE((metadata->>'ind_18_24')::numeric, 0))::integer AS ind_18_24,
        SUM(COALESCE((metadata->>'ind_25_39')::numeric, 0))::integer AS ind_25_39,
        SUM(COALESCE((metadata->>'ind_40_54')::numeric, 0))::integer AS ind_40_54,
        SUM(COALESCE((metadata->>'ind_55_64')::numeric, 0))::integer AS ind_55_64,
        SUM(COALESCE((metadata->>'ind_65_79')::numeric, 0))::integer AS ind_65_79,
        SUM(COALESCE((metadata->>'ind_80p')::numeric,   0))::integer AS ind_80p,
        SUM(COALESCE((metadata->>'men')::numeric,       0))::integer AS menages_total,
        SUM(COALESCE((metadata->>'men_pauv')::numeric,  0))::integer AS menages_pauvres,
        SUM(COALESCE((metadata->>'men_1ind')::numeric,  0))::integer AS menages_1_personne,
        SUM(COALESCE((metadata->>'men_5ind')::numeric,  0))::integer AS menages_5_plus,
        SUM(COALESCE((metadata->>'men_prop')::numeric,  0))::integer AS menages_proprietaires,
        SUM(COALESCE((metadata->>'men_fmp')::numeric,   0))::integer AS familles_monoparentales,
        SUM(COALESCE((metadata->>'men_mais')::numeric,  0))::integer AS menages_maison,
        SUM(COALESCE((metadata->>'men_coll')::numeric,  0))::integer AS menages_collectif,
        AVG(COALESCE((metadata->>'men_surf')::numeric,  0))::numeric(6,1) AS surface_moyenne,
        CASE
          WHEN SUM(COALESCE((metadata->>'ind')::numeric, 0)) > 0
          THEN (SUM(COALESCE((metadata->>'ind_snv')::numeric, 0) * COALESCE((metadata->>'ind')::numeric, 0))
               / NULLIF(SUM(COALESCE((metadata->>'ind')::numeric, 0)), 0))::integer
          ELSE 0
        END AS revenu_median,
        SUM(COALESCE((metadata->>'log_av45')::numeric,  0))::integer AS logements_avant_1945,
        SUM(COALESCE((metadata->>'log_45_70')::numeric, 0))::integer AS logements_1945_1970,
        SUM(COALESCE((metadata->>'log_70_90')::numeric, 0))::integer AS logements_1970_1990,
        SUM(COALESCE((metadata->>'log_ap90')::numeric,  0))::integer AS logements_apres_1990,
        SUM(COALESCE((metadata->>'log_soc')::numeric,   0))::integer AS logements_sociaux,
        SUM(COALESCE((metadata->>'log_inc')::numeric,   0))::integer AS logements_inconnus
      FROM carreaux_filosofi
      WHERE resolution = '200m' AND geom_3857 IS NOT NULL
      GROUP BY ST_SnapToGrid(ST_Centroid(geom_3857), 1000)
    `);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Insertion terminée en ${elapsed}s`);

    // Index spatial
    console.log('Création de l\'index GIST...');
    await client.query(`
      DROP INDEX IF EXISTS idx_carreaux_1km_geom_3857;
      CREATE INDEX idx_carreaux_1km_geom_3857 ON carreaux_1km USING GIST (geom_3857);
    `);

    // ANALYZE
    await client.query(`ANALYZE carreaux_1km`);

    const { rows: [{ final }] } = await client.query<{ final: string }>(
      `SELECT COUNT(*) AS final FROM carreaux_1km`
    );
    console.log(`\nTermine ! ${parseInt(final, 10).toLocaleString()} mailles 1km creees.`);
    console.log('Prochaine etape : appliquer migration 045_update_get_tile.sql dans Supabase Dashboard.');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
