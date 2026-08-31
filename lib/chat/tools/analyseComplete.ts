/**
 * lib/chat/tools/analyseComplete.ts
 * Outil analyse_complete — rapport complet d'une zone en 1 step.
 *
 * Source démographique (par ordre de priorité) :
 *   1. Table public.iris (agrégation par code_commune) — précision communale exacte
 *   2. Fallback : smart_demographie_stats RPC (carreaux Filosofi 200m, rayon km)
 */

import { createAdminClient }                     from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getCoordsForVille, getCoordsForRegion } from '@/lib/geo/locations';
import { CHORO_INDICATORS }                      from '@/lib/chat/system-prompt';
import { IRIS_DB_COLUMNS }                       from '@/lib/iris-crawler/db-columns';
import { getOrgSourceIds }                       from './orgContext';

/** Rayon Filosofi adapté au type de périmètre (km) — utilisé en fallback uniquement. */
const RAYON_PAR_TYPE: Record<string, number> = {
  ville:         5,
  agglomeration: 15,
  departement:   50,
  region:        100,
  isochrone:     10,
};

/** Indicateurs Filosofi utilisés en fallback. */
const INDICATEURS_PROFIL = [
  'ind', 'ind_18_24', 'ind_25_39', 'ind_40_54', 'ind_55_64', 'ind_65_79', 'ind_snv',
] as const;

type DemoRow = {
  total?:       number;
  moyenne?:     number;
  mediane?:     number;
  nb_carreaux?: number;
  error?:       string;
};

/** Labels affichables pour les colonnes IRIS — dérivés de IRIS_DB_COLUMNS. */
const IRIS_LABELS: Record<string, string> = Object.fromEntries(
  IRIS_DB_COLUMNS.map(c => [c.name, c.label])
);

/** Mapping indicateur Filosofi → colonne IRIS (approximation par tranche d'âge). */
const CIBLE_TO_IRIS: Record<string, string> = {
  'ind':       'population',
  'ind_18_24': 'pop_15_29',
  'ind_25_39': 'pop_30_44',
  'ind_40_54': 'pop_45_59',
  'ind_55_64': 'pop_60_74',
  'ind_65_79': 'pop_60_74',
  'ind_80p':   'pop_75_plus',
  'men':       'nb_menages',
};

/** Benchmarks nationaux INSEE par colonne IRIS.
 *  Sources : RP 2022 (tranches âge), Filosofi 2021 (rev_median), RP 2022 (emploi/logement/diplômes).
 *  Les colonnes CSP et nb_* sont des valeurs absolues — benchmark national non pertinent (omis).
 */
const FRANCE_POP_PCT: Record<string, number> = {
  // Tranches d'âge — RP 2022 (% de la population totale)
  'pop_0_14':        17.5,
  'pop_15_29':       17.8,
  'pop_30_44':       19.5,
  'pop_45_59':       19.8,
  'pop_60_74':       16.2,
  'pop_75_plus':      9.2,
  'population':      100.0,
  'nb_menages':      100.0,  // non pertinent — supprimé du benchmarking dans ce cas
  // Socio-économique — RP 2022 / Filosofi 2021
  'taux_chomage':     7.3,   // Taux de chômage au sens BIT — T4 2023
  'taux_proprio':    57.6,   // Taux de propriétaires occupants — RP 2020
  'taux_diplome_sup': 27.5,  // Part diplômés bac+2 et plus (25-64 ans) — RP 2022
};

// SYNC: doit couvrir toutes les colonnes de IRIS_DB_COLUMNS dans db-columns.ts
type IrisRow = {
  code_iris:         string | null;
  nom_iris:          string | null;
  // Population
  population:        number | null;
  nb_menages:        number | null;
  // Tranches d'âge
  pop_0_14:          number | null;
  pop_15_29:         number | null;
  pop_30_44:         number | null;
  pop_45_59:         number | null;
  pop_60_74:         number | null;
  pop_75_plus:       number | null;
  // Revenus & emploi
  rev_median:        number | null;
  taux_chomage:      number | null;
  taux_proprio:      number | null;
  // Diplômes
  nb_diplome_aucun:  number | null;
  nb_diplome_bac:    number | null;
  nb_diplome_sup:    number | null;
  taux_diplome_sup:  number | null;
  // CSP
  nb_csp_cadre:      number | null;
  nb_csp_employe:    number | null;
  nb_csp_ouvrier:    number | null;
  // Indicateurs dérivés v2
  densite_pop:               number | null;
  indice_jeunesse:           number | null;
  part_pop_etrangere:        number | null;
  part_pop_moins_18:         number | null;
  part_pop_65_plus:          number | null;
  part_residences_principales: number | null;
  part_appartements:         number | null;
  part_logements_sociaux:    number | null;
  part_menages_emmenages_2ans: number | null;
  part_familles_monoparentales: number | null;
  part_couples_avec_enfants: number | null;
  part_actifs_marche_velo:   number | null;
  part_actifs_transport_commun: number | null;
  part_hommes_actifs:        number | null;
  part_femmes_actives:       number | null;
  part_sans_diplome:         number | null;
  nb_emplois_commune:        number | null;
  // Géo
  centroid_lat:      number | null;
  centroid_lng:      number | null;
};

function sumIris(rows: IrisRow[], col: keyof IrisRow): number {
  return rows.reduce((s, r) => s + ((r[col] as number | null) ?? 0), 0);
}

export async function analyseComplete(args: Record<string, unknown>) {
  const perimetre_type  = String(args.perimetre_type  ?? 'ville');
  const perimetre_value = String(args.perimetre_value ?? '');
  const cible           = String(args.cible           ?? 'ind_18_24');
  const poi_categories  = Array.isArray(args.poi_categories)
    ? (args.poi_categories as unknown[]).map(String)
    : [];

  if (!perimetre_value.trim()) {
    return { error: "Périmètre requis pour l'analyse complète." };
  }

  const supabase     = createAdminClient();
  const orgSourceIds = getOrgSourceIds();

  if (orgSourceIds !== null && orgSourceIds.length === 0) {
    return { error: "Aucune source configurée pour votre organisation." };
  }

  const coords   = perimetre_type === 'region'
    ? getCoordsForRegion(perimetre_value)
    : getCoordsForVille(perimetre_value);
  const rayon_km = RAYON_PAR_TYPE[perimetre_type] ?? 5;
  const geoField = perimetre_type === 'region' ? 'region' : 'ville';

  // ── Résolution code_commune depuis la table iris ───────────────────────────
  let code_commune: string | null = null;
  if (perimetre_type === 'ville' || perimetre_type === 'agglomeration') {
    const { data: communeData } = await supabase
      .from('iris')
      .select('code_commune')
      .ilike('nom_commune', perimetre_value)
      .limit(1)
      .single();
    code_commune = communeData?.code_commune ?? null;
  }

  logger.debug('analyse_complete', `source ${code_commune ? 'IRIS' : 'carreaux'} commune: ${code_commune}`);

  // ── Requêtes légères : panneaux + POI (parallèles dans tous les cas) ───────
  let panneauxQ = supabase
    .from('panneaux_affichage')
    .select('id, regie, type_panneau')
    .eq('actif', true)
    .ilike('ville', `%${perimetre_value}%`)
    .limit(2000);
  if (orgSourceIds !== null) panneauxQ = panneauxQ.in('data_source_id', orgSourceIds);

  const poiPromises = poi_categories.map(cat =>
    supabase
      .from('poi_france')
      .select('id', { count: 'exact', head: true })
      .ilike(geoField, `%${perimetre_value}%`)
      .eq('categorie', cat),
  );

  // ── Branche IRIS ──────────────────────────────────────────────────────────
  if (code_commune) {
    const [irisResult, panneauxResult, poiResults] = await Promise.all([
      supabase
        .from('iris')
        .select('code_iris, nom_iris, population, nb_menages, pop_0_14, pop_15_29, pop_30_44, pop_45_59, pop_60_74, pop_75_plus, rev_median, taux_chomage, taux_proprio, nb_diplome_aucun, nb_diplome_bac, nb_diplome_sup, taux_diplome_sup, nb_csp_cadre, nb_csp_employe, nb_csp_ouvrier, densite_pop, indice_jeunesse, part_pop_etrangere, part_pop_moins_18, part_pop_65_plus, part_residences_principales, part_appartements, part_logements_sociaux, part_menages_emmenages_2ans, part_familles_monoparentales, part_couples_avec_enfants, part_actifs_marche_velo, part_actifs_transport_commun, part_hommes_actifs, part_femmes_actives, part_sans_diplome, nb_emplois_commune, centroid_lat, centroid_lng')
        .eq('code_commune', code_commune)
        .in('type_iris', ['H', 'Z']),  // H = habitat (urbain), Z = commune non découpée (rural)
      panneauxQ,
      Promise.all(poiPromises),
    ]);

    const irisStats = (irisResult.data ?? []) as IrisRow[];

    // Agrégation population par tranche
    const pop_totale    = sumIris(irisStats, 'population');
    const sum_pop_0_14  = sumIris(irisStats, 'pop_0_14');
    const sum_pop_15_29 = sumIris(irisStats, 'pop_15_29');
    const sum_pop_30_44 = sumIris(irisStats, 'pop_30_44');
    const sum_pop_45_59 = sumIris(irisStats, 'pop_45_59');
    const sum_pop_60_74 = sumIris(irisStats, 'pop_60_74');
    const sum_pop_75    = sumIris(irisStats, 'pop_75_plus');

    // Revenu médian pondéré par population IRIS
    const rev_median = pop_totale > 0
      ? Math.round(
          irisStats.reduce((s, r) => s + (r.rev_median ?? 0) * (r.population ?? 0), 0) / pop_totale,
        )
      : 0;

    // Cible : mapping Filosofi → colonne IRIS
    const irisCol    = (CIBLE_TO_IRIS[cible] ?? 'pop_15_29') as keyof IrisRow;
    const cibleTotal = sumIris(irisStats, irisCol);
    const cibleLabel = IRIS_LABELS[irisCol as string] ?? CHORO_INDICATORS[cible]?.label ?? cible;

    const tranches_age = [
      { id: 'pop_0_14',    label: '0-14 ans',  total: sum_pop_0_14  },
      { id: 'pop_15_29',   label: '15-29 ans', total: sum_pop_15_29 },
      { id: 'pop_30_44',   label: '30-44 ans', total: sum_pop_30_44 },
      { id: 'pop_45_59',   label: '45-59 ans', total: sum_pop_45_59 },
      { id: 'pop_60_74',   label: '60-74 ans', total: sum_pop_60_74 },
      { id: 'pop_75_plus', label: '75+ ans',   total: sum_pop_75    },
    ]
      .map(t => ({
        ...t,
        pourcentage: pop_totale > 0 ? Math.round(t.total / pop_totale * 1000) / 10 : 0,
      }))
      .filter(t => t.total > 0);

    // Traitement panneaux
    const panneaux = (panneauxResult.data ?? []) as Array<{ regie: string | null; type_panneau: string | null }>;
    const regieMap: Record<string, number> = {};
    for (const p of panneaux) {
      const r = p.regie ?? 'Autre';
      regieMap[r] = (regieMap[r] ?? 0) + 1;
    }
    const par_regie = Object.entries(regieMap)
      .sort((a, b) => b[1] - a[1])
      .map(([regie, count]) => ({
        regie,
        count,
        pourcentage: panneaux.length > 0 ? Math.round(count / panneaux.length * 1000) / 10 : 0,
      }));

    // Traitement POI
    const poi_summary = poi_categories
      .map((cat, i) => ({
        categorie: cat,
        label:     cat,
        count:     (poiResults[i] as { count: number | null }).count ?? 0,
      }))
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count);

    logger.debug('chat', `analyse_complete(${perimetre_type}, ${perimetre_value}, ${cible}) → ` +
      `pop=${pop_totale}, iris=${irisStats.length}, panneaux=${panneaux.length}, poi=${poi_summary.length} catégories`);

    return {
      type:               "analyse_complete",
      display_perimetre:  `Commune de ${perimetre_value} (données IRIS)`,
      perimetre: {
        type:        perimetre_type,
        value:       perimetre_value,
        lat:         coords.lat,
        lng:         coords.lng,
        rayon_km,
        code_commune,
        source_demo: "iris",
      },
      coordonnees: coords,
      demographie: {
        population_totale: pop_totale,
        cible: {
          indicateur:  cible,
          label:       cibleLabel,
          total:       cibleTotal,
          pourcentage: pop_totale > 0 ? Math.round(cibleTotal / pop_totale * 1000) / 10 : 0,
        },
        tranches_age,
        revenu_median: rev_median,
      },
      panneaux: {
        total:     panneaux.length,
        par_regie,
      },
      poi: poi_summary,
      metadata: {
        source:         "INSEE IRIS (limites communales)",
        date_source:    "2022",
        date_panneaux:  "2025",
        generated_at:   new Date().toISOString().split('T')[0],
      },
      benchmarks: {
        france_pop_pct:    FRANCE_POP_PCT[irisCol as string] ?? null,
        france_rev_median: 23_080,
      },
      iris_distribution: irisStats
        .map(r => ({
          code_iris: r.code_iris ?? "",
          nom:       r.nom_iris ?? "",
          pop:       r.population ?? 0,
          cible:     (r[irisCol] as number | null) ?? 0,
          lat:       r.centroid_lat ?? null,
          lng:       r.centroid_lng ?? null,
        }))
        .filter(r => r.pop > 0)
        .sort((a, b) => b.cible - a.cible)
        .slice(0, 15),
    };
  }

  // ── Fallback : carreaux Filosofi (smart_demographie_stats) ────────────────
  const demoResults: Awaited<ReturnType<typeof supabase.rpc>>[] = [];
  for (const ind of INDICATEURS_PROFIL) {
    const r = await supabase.rpc('smart_demographie_stats', {
      p_lat:        coords.lat,
      p_lng:        coords.lng,
      p_indicateur: ind,
      p_rayon_km:   rayon_km,
    });
    demoResults.push(r);
  }

  const [panneauxResult, poiResults] = await Promise.all([
    panneauxQ,
    Promise.all(poiPromises),
  ]);

  const demoMap: Record<string, DemoRow> = {};
  INDICATEURS_PROFIL.forEach((ind, i) => {
    const r = demoResults[i];
    demoMap[ind] = (r.data ?? {}) as DemoRow;
  });

  const popTotale  = Math.round(demoMap['ind']?.total ?? 0);
  const cibleKey   = (INDICATEURS_PROFIL as readonly string[]).includes(cible) ? cible : 'ind_18_24';
  const cibleTotal = Math.round(demoMap[cibleKey]?.total ?? 0);
  const cibleLabel = CHORO_INDICATORS[cible]?.label ?? cible;

  const tranches_age = (['ind_18_24', 'ind_25_39', 'ind_40_54', 'ind_55_64', 'ind_65_79'] as const)
    .map(ind => {
      const t = Math.round(demoMap[ind]?.total ?? 0);
      return {
        id:          ind,
        label:       CHORO_INDICATORS[ind]?.label ?? ind,
        total:       t,
        pourcentage: popTotale > 0 ? Math.round(t / popTotale * 1000) / 10 : 0,
      };
    })
    .filter(t => t.total > 0);

  const snvTotal      = demoMap['ind_snv']?.total ?? 0;
  const popForRevenu  = demoMap['ind']?.total ?? 0;
  const revenu_median = popForRevenu > 0 ? Math.round(snvTotal / popForRevenu) : 0;

  const panneaux = (panneauxResult.data ?? []) as Array<{ regie: string | null; type_panneau: string | null }>;
  const regieMap: Record<string, number> = {};
  for (const p of panneaux) {
    const r = p.regie ?? 'Autre';
    regieMap[r] = (regieMap[r] ?? 0) + 1;
  }
  const par_regie = Object.entries(regieMap)
    .sort((a, b) => b[1] - a[1])
    .map(([regie, count]) => ({
      regie,
      count,
      pourcentage: panneaux.length > 0 ? Math.round(count / panneaux.length * 1000) / 10 : 0,
    }));

  const poi_summary = poi_categories
    .map((cat, i) => ({
      categorie: cat,
      label:     cat,
      count:     (poiResults[i] as { count: number | null }).count ?? 0,
    }))
    .filter(p => p.count > 0)
    .sort((a, b) => b.count - a.count);

  logger.debug('chat', `analyse_complete(${perimetre_type}, ${perimetre_value}, ${cible}) → ` +
    `pop=${popTotale}, panneaux=${panneaux.length}, poi=${poi_summary.length} catégories`);

  return {
    type:               "analyse_complete",
    display_perimetre:  `Rayon ${rayon_km} km autour de ${perimetre_value}`,
    perimetre: {
      type:        perimetre_type,
      value:       perimetre_value,
      lat:         coords.lat,
      lng:         coords.lng,
      rayon_km,
      source_demo: "carreaux",
    },
    coordonnees: coords,
    demographie: {
      population_totale: popTotale,
      cible: {
        indicateur:  cible,
        label:       cibleLabel,
        total:       cibleTotal,
        pourcentage: popTotale > 0 ? Math.round(cibleTotal / popTotale * 1000) / 10 : 0,
      },
      tranches_age,
      revenu_median,
    },
    panneaux: {
      total:     panneaux.length,
      par_regie,
    },
    poi: poi_summary,
    metadata: {
      source:        `Carreaux Filosofi 200m (rayon ${rayon_km} km)`,
      date_source:   "2021",
      date_panneaux: "2025",
      generated_at:  new Date().toISOString().split('T')[0],
    },
    benchmarks: {
      france_pop_15_29_pct: 17.8,
      france_rev_median:    23_080,
    },
    iris_distribution: [],
  };
}
