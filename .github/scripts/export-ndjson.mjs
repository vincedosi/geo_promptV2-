/**
 * Export carreaux_filosofi → NDJSON via Supabase RPC (keyset pagination)
 * Utilisé dans GitHub Actions pour générer le PMTiles
 */
import { createClient } from '@supabase/supabase-js';
import { createWriteStream } from 'fs';
import { resolve } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH = 5000;
const OUT = resolve('carreaux_filosofi.ndjson');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const stream = createWriteStream(OUT, { encoding: 'utf8' });

async function main() {
  // Count total
  const { count } = await supabase
    .from('carreaux_filosofi')
    .select('*', { count: 'exact', head: true })
    .not('metadata', 'is', null)
    .not('geom', 'is', null);
  console.log(`[export] ${count?.toLocaleString()} carreaux à exporter`);
  console.log(`[export] Écriture → ${OUT}`);

  let lastIdcar = '';
  let written = 0;

  while (true) {
    const { data, error } = await supabase.rpc('export_carreaux_after', {
      p_last_idcar: lastIdcar,
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
          idcar: row.idcar,
          ind: row.population_totale,
          ind_inc: row.population_inconnue,
          ind_0_3: row.ind_0_3,
          ind_4_5: row.ind_4_5,
          ind_6_10: row.ind_6_10,
          ind_11_17: row.ind_11_17,
          ind_18_24: row.ind_18_24,
          ind_25_39: row.ind_25_39,
          ind_40_54: row.ind_40_54,
          ind_55_64: row.ind_55_64,
          ind_65_79: row.ind_65_79,
          ind_80p: row.ind_80p,
          men: row.menages_total,
          men_pauv: row.menages_pauvres,
          men_1ind: row.menages_1_personne,
          men_5ind: row.menages_5_plus,
          men_prop: row.menages_proprietaires,
          men_fmp: row.familles_monoparentales,
          men_mais: row.menages_maison,
          men_coll: row.menages_collectif,
          surface_moyenne: row.surface_moyenne,
          revenu_median: row.revenu_median,
          log_av45: row.logements_avant_1945,
          log_45_70: row.logements_1945_1970,
          log_70_90: row.logements_1970_1990,
          log_ap90: row.logements_apres_1990,
          log_soc: row.logements_sociaux,
          log_inc: row.logements_inconnus,
        },
      };
      stream.write(JSON.stringify(feature) + '\n');
      written++;
    }

    lastIdcar = data[data.length - 1].idcar;
    if (written % 100_000 < BATCH) {
      console.log(`  ${written.toLocaleString()} lignes exportées...`);
    }
    if (data.length < BATCH) break;
  }

  await new Promise((resolve) => stream.end(resolve));
  console.log(`[export] Terminé : ${written.toLocaleString()} carreaux`);
}

main().catch((e) => { console.error(e); process.exit(1); });
