/**
 * Export IRIS → NDJSON pour génération PMTiles en local
 * Lit les variables depuis .env.local automatiquement
 *
 * Usage :
 *   node scripts/export-iris-local.mjs
 *
 * Prérequis :
 *   - .env.local avec NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 *   - Fonction export_iris_after appliquée en base (sql/063_export_iris_after.sql)
 *
 * Ensuite, générer le PMTiles avec tippecanoe (WSL / Linux / Mac) :
 *   tippecanoe -o iris_france.pmtiles -Z5 -z14 -l iris \
 *     --no-feature-limit --no-tile-size-limit \
 *     --coalesce-densest-as-needed --extend-zooms-if-still-dropping \
 *     iris.ndjson
 */

import { createClient } from '@supabase/supabase-js';
import { createWriteStream, readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

// ── Lire .env.local ───────────────────────────────────────────────────────────
function loadEnvLocal() {
  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH = 5000;
const OUT = resolve('iris.ndjson');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Erreur : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const stream = createWriteStream(OUT, { encoding: 'utf8' });

async function main() {
  const { count } = await supabase
    .from('iris')
    .select('*', { count: 'exact', head: true });
  console.log(`[export] ${count?.toLocaleString()} IRIS à exporter`);
  console.log(`[export] Écriture → ${OUT}`);

  let lastCodeIris = '';
  let written = 0;

  while (true) {
    const { data, error } = await supabase.rpc('export_iris_after', {
      p_last_code_iris: lastCodeIris,
      p_limit: BATCH,
    });

    if (error) throw new Error(`RPC error: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const geometry = JSON.parse(row.geom_json);
      const feature = {
        type: 'Feature',
        geometry,
        properties: {
          code_iris:        row.code_iris,
          nom_iris:         row.nom_iris,
          type_iris:        row.type_iris,
          population:       row.population       ?? 0,
          pop_0_14:         row.pop_0_14         ?? 0,
          pop_15_29:        row.pop_15_29        ?? 0,
          pop_30_44:        row.pop_30_44        ?? 0,
          pop_45_59:        row.pop_45_59        ?? 0,
          pop_60_74:        row.pop_60_74        ?? 0,
          pop_75_plus:      row.pop_75_plus      ?? 0,
          nb_menages:       row.nb_menages       ?? 0,
          rev_median:       row.rev_median       ?? 0,
          taux_chomage:     row.taux_chomage     ?? 0,
          taux_proprio:     row.taux_proprio     ?? 0,
          nb_diplome_aucun: row.nb_diplome_aucun ?? 0,
          nb_diplome_bac:   row.nb_diplome_bac   ?? 0,
          nb_diplome_sup:   row.nb_diplome_sup   ?? 0,
          taux_diplome_sup: row.taux_diplome_sup ?? 0,
          nb_csp_cadre:     row.nb_csp_cadre     ?? 0,
          nb_csp_employe:   row.nb_csp_employe   ?? 0,
          nb_csp_ouvrier:   row.nb_csp_ouvrier   ?? 0,
        },
      };
      stream.write(JSON.stringify(feature) + '\n');
      written++;
    }

    lastCodeIris = data[data.length - 1].code_iris;
    if (written % 10_000 < BATCH) {
      process.stdout.write(`  ${written.toLocaleString()} IRIS exportés...\r`);
    }
    if (data.length < BATCH) break;
  }

  await new Promise((res) => stream.end(res));
  console.log(`\n[export] Terminé : ${written.toLocaleString()} IRIS → ${OUT}`);
  console.log('\nÉtape suivante — tippecanoe (WSL) :');
  console.log('  tippecanoe -o iris_france.pmtiles -Z5 -z14 -l iris \\');
  console.log('    --no-feature-limit --no-tile-size-limit \\');
  console.log('    --coalesce-densest-as-needed --extend-zooms-if-still-dropping \\');
  console.log('    iris.ndjson');
}

main().catch((e) => { console.error(e); process.exit(1); });
