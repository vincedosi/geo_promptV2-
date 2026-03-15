/**
 * populate-geom-centroid.mjs
 * Met à jour la colonne geom_centroid sur carreaux_filosofi en batches
 * Connexion directe PostgreSQL (pas via PostgREST) → pas de timeout HTTP
 *
 * Usage :
 *   node scripts/populate-geom-centroid.mjs
 *
 * Requiert : DATABASE_URL dans .env.local (ou variable d'env)
 *   Format : postgresql://postgres.[ref]:[password]@[host]:5432/postgres
 *   Trouvable : Supabase Dashboard → Settings → Database → Connection string → URI
 */

import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Chargement .env.local ──────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env.local');
try {
  const env = readFileSync(envPath, 'utf-8');
  for (const line of env.split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length && !process.env[key.trim()]) {
      process.env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
} catch {}

// ── Connection string ──────────────────────────────────────────────────────
// Priorité : DATABASE_URL → SUPABASE_DB_URL → DIRECT_URL
const connStr =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DIRECT_URL;

if (!connStr) {
  console.error('❌  Aucune connection string trouvée.');
  console.error('    Ajoute dans .env.local :');
  console.error('    DATABASE_URL=postgresql://postgres.[ref]:[password]@[host]:5432/postgres');
  console.error('    (Supabase Dashboard → Settings → Database → Connection string → URI)');
  process.exit(1);
}

const sql = postgres(connStr, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 30,
});

const BATCH = 50_000;

async function main() {
  console.log('Connexion à PostgreSQL...');

  // Vérifier l'état initial
  const [{ remaining }] = await sql`
    SELECT COUNT(*) FILTER (WHERE geom_centroid IS NULL) AS remaining
    FROM carreaux_filosofi
  `;

  if (Number(remaining) === 0) {
    console.log('✓  Colonne geom_centroid déjà complètement remplie.');
    await sql.end();
    return;
  }

  console.log(`→  ${remaining} carreaux à mettre à jour (batches de ${BATCH.toLocaleString()})`);
  console.log('');

  let total = 0;
  let batch = 1;

  while (true) {
    const t0 = Date.now();

    const result = await sql`
      UPDATE carreaux_filosofi
      SET geom_centroid = ST_Centroid(geom)
      WHERE id IN (
        SELECT id FROM carreaux_filosofi
        WHERE geom_centroid IS NULL
        LIMIT ${BATCH}
      )
    `;

    const n = result.count;
    if (n === 0) break;

    total += n;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const pct = Math.round((total / Number(remaining)) * 100);
    console.log(`  batch ${batch}  +${n.toLocaleString()} lignes  ${elapsed}s  [${pct}% — ${total.toLocaleString()}/${Number(remaining).toLocaleString()}]`);
    batch++;
  }

  console.log('');
  console.log(`✓  ${total.toLocaleString()} carreaux mis à jour.`);
  console.log('');
  console.log('Étape suivante dans Supabase SQL Editor :');
  console.log('  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_carreaux_filosofi_geom_centroid');
  console.log('    ON carreaux_filosofi USING GIST (geom_centroid);');
  console.log('  VACUUM ANALYZE carreaux_filosofi;');

  await sql.end();
}

main().catch(err => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
