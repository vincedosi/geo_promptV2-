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
          rev_d1:           row.rev_d1           ?? 0,
          rev_d9:           row.rev_d9           ?? 0,
          taux_pauvrete:    row.taux_pauvrete    ?? 0,
          indice_gini:      row.indice_gini      ?? 0,
          taux_chomage:     row.taux_chomage     ?? 0,
          taux_emploi:      row.taux_emploi      ?? 0,
          nb_emplois:       row.nb_emplois       ?? 0,
          taux_proprio:     row.taux_proprio     ?? 0,
          nb_diplome_aucun: row.nb_diplome_aucun ?? 0,
          nb_diplome_bac:   row.nb_diplome_bac   ?? 0,
          nb_diplome_sup:   row.nb_diplome_sup   ?? 0,
          taux_diplome_sup: row.taux_diplome_sup ?? 0,
          nb_csp_cadre:     row.nb_csp_cadre     ?? 0,
          nb_csp_employe:   row.nb_csp_employe   ?? 0,
          nb_csp_ouvrier:   row.nb_csp_ouvrier   ?? 0,
          densite_pop:               row.densite_pop               ?? 0,
          indice_jeunesse:           row.indice_jeunesse           ?? 0,
          part_pop_etrangere:        row.part_pop_etrangere        ?? 0,
          part_pop_moins_18:         row.part_pop_moins_18         ?? 0,
          part_pop_65_plus:          row.part_pop_65_plus          ?? 0,
          part_residences_principales: row.part_residences_principales ?? 0,
          part_appartements:         row.part_appartements         ?? 0,
          part_logements_sociaux:    row.part_logements_sociaux    ?? 0,
          part_menages_emmenages_2ans: row.part_menages_emmenages_2ans ?? 0,
          part_familles_monoparentales: row.part_familles_monoparentales ?? 0,
          part_couples_avec_enfants: row.part_couples_avec_enfants ?? 0,
          part_actifs_marche_velo:   row.part_actifs_marche_velo   ?? 0,
          part_actifs_transport_commun: row.part_actifs_transport_commun ?? 0,
          part_hommes_actifs:        row.part_hommes_actifs        ?? 0,
          part_femmes_actives:       row.part_femmes_actives       ?? 0,
          part_sans_diplome:         row.part_sans_diplome         ?? 0,
          nb_emplois_commune:        row.nb_emplois_commune        ?? 0,
          is_true_iris:              row.is_true_iris              ?? false,
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
