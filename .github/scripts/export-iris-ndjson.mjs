/**
 * Export iris → NDJSON via Supabase RPC (keyset pagination sur code_iris)
 * Utilisé dans GitHub Actions pour générer iris.pmtiles
 *
 * Prérequis : migration 063 (export_iris_after) appliquée en base
 */
import { createClient } from '@supabase/supabase-js';
import { createWriteStream } from 'fs';
import { resolve } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH = 5000;
const OUT = resolve('iris.ndjson');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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
          code_iris:      row.code_iris,
          nom_iris:       row.nom_iris,
          type_iris:      row.type_iris,
          population:     row.population,
          pop_0_14:       row.pop_0_14,
          pop_15_29:      row.pop_15_29,
          pop_30_44:      row.pop_30_44,
          pop_45_59:      row.pop_45_59,
          pop_60_74:      row.pop_60_74,
          pop_75_plus:    row.pop_75_plus,
          nb_csp_cadre:   row.nb_csp_cadre,
          nb_csp_employe: row.nb_csp_employe,
          nb_csp_ouvrier: row.nb_csp_ouvrier,
        },
      };
      stream.write(JSON.stringify(feature) + '\n');
      written++;
    }

    lastCodeIris = data[data.length - 1].code_iris;
    if (written % 10_000 < BATCH) {
      console.log(`  ${written.toLocaleString()} IRIS exportés...`);
    }
    if (data.length < BATCH) break;
  }

  await new Promise((resolve) => stream.end(resolve));
  console.log(`[export] Terminé : ${written.toLocaleString()} IRIS`);
}

main().catch((e) => { console.error(e); process.exit(1); });
