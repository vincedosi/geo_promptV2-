/**
 * lib/chat/tools/analyseComplete.ts
 * Outil analyse_complete — rapport complet d'une zone en 1 step.
 * Appelle Supabase directement (pas via d'autres tools LLM) :
 *   - smart_demographie_stats RPC × plusieurs indicateurs (en parallèle)
 *   - global_ooh par ville
 *   - poi_france COUNT par catégorie
 */

import { createAdminClient }                     from '@/lib/auth';
import { getCoordsForVille, getCoordsForRegion } from '@/lib/geo/locations';
import { CHORO_INDICATORS }                      from '@/lib/chat/system-prompt';
import { getOrgSourceIds }                       from './orgContext';

/** Rayon Filosofi adapté au type de périmètre (km). */
const RAYON_PAR_TYPE: Record<string, number> = {
  ville:         5,
  agglomeration: 15,
  departement:   50,
  region:        100,
  isochrone:     10,
};

/** Indicateurs utilisés pour bâtir le profil démographique. */
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

  // ── 1. Requêtes démo multi-indicateurs ────────────────────────────────────
  const demoPromises = INDICATEURS_PROFIL.map(ind =>
    supabase.rpc('smart_demographie_stats', {
      p_lat:        coords.lat,
      p_lng:        coords.lng,
      p_indicateur: ind,
      p_rayon_km:   rayon_km,
    }),
  );

  // ── 2. Panneaux OOH dans la zone ──────────────────────────────────────────
  let panneauxQ = supabase
    .from('global_ooh')
    .select('id, regie, type_panneau')
    .eq('statut', 'actif')
    .ilike('ville', `%${perimetre_value}%`)
    .limit(2000);
  if (orgSourceIds !== null) panneauxQ = panneauxQ.in('data_source_id', orgSourceIds);

  // ── 3. POI COUNT par catégorie ────────────────────────────────────────────
  const poiPromises = poi_categories.map(cat =>
    supabase
      .from('poi_france')
      .select('id', { count: 'exact', head: true })
      .ilike(geoField, `%${perimetre_value}%`)
      .eq('categorie', cat),
  );

  // ── Tout en parallèle ─────────────────────────────────────────────────────
  const [demoResults, panneauxResult, poiResults] = await Promise.all([
    Promise.all(demoPromises),
    panneauxQ,
    Promise.all(poiPromises),
  ]);

  // ── Traitement démo ───────────────────────────────────────────────────────
  const demoMap: Record<string, DemoRow> = {};
  INDICATEURS_PROFIL.forEach((ind, i) => {
    demoMap[ind] = (demoResults[i].data ?? {}) as DemoRow;
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

  // Revenu : ind_snv = somme des niveaux de vie du carreau → diviser par population
  const snvTotal = demoMap['ind_snv']?.total ?? 0;
  const popForRevenu = demoMap['ind']?.total ?? 0;
  const revenu_median = popForRevenu > 0 ? Math.round(snvTotal / popForRevenu) : 0;

  // ── Traitement panneaux ───────────────────────────────────────────────────
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

  // ── Traitement POI ────────────────────────────────────────────────────────
  const poi_summary = poi_categories
    .map((cat, i) => ({
      categorie: cat,
      label:     cat,
      count:     (poiResults[i] as { count: number | null }).count ?? 0,
    }))
    .filter(p => p.count > 0)
    .sort((a, b) => b.count - a.count);

  console.log(
    `[chat] analyse_complete(${perimetre_type}, ${perimetre_value}, ${cible}) → ` +
    `pop=${popTotale}, panneaux=${panneaux.length}, poi=${poi_summary.length} catégories`,
  );

  return {
    type: "analyse_complete",
    perimetre: {
      type:     perimetre_type,
      value:    perimetre_value,
      lat:      coords.lat,
      lng:      coords.lng,
      rayon_km,
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
  };
}
