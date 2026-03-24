/**
 * lib/chat/tools/askConfiguration.ts
 * Outil ask_configuration — retourne les options disponibles pour configurer
 * une analyse complète (cibles démo + catégories POI présentes dans la zone).
 */

import { createAdminClient }                        from '@/lib/auth';
import { getDistinctCategories }                    from '@/lib/poi/categories';
import { CHORO_INDICATORS }                         from '@/lib/chat/system-prompt';
import { getCoordsForVille, getCoordsForRegion }    from '@/lib/geo/locations';

/** Cibles démographiques utiles pour la planification OOH. */
const CIBLES_UTILES = [
  'ind',       // Population totale
  'ind_18_24', // Jeunes 18-24 ans
  'ind_25_39', // Adultes 25-39 ans
  'ind_40_54', // Adultes 40-54 ans
  'ind_55_64', // Seniors 55-64 ans
  'ind_65_79', // Seniors 65-79 ans
  'ind_80p',   // 80 ans et +
  'men',       // Ménages
  'men_pauv',  // Ménages pauvres
  'men_fmp',   // Familles monoparentales
  'ind_snv',   // Revenu médian
  'log_soc',   // Logements sociaux
];

export async function askConfiguration(args: Record<string, unknown>) {
  const perimetre_type  = String(args.perimetre_type  ?? 'ville');
  const perimetre_value = String(args.perimetre_value ?? '');

  if (!perimetre_value.trim()) {
    return { error: "Périmètre requis pour configurer l'analyse." };
  }

  // ── Cibles démo disponibles ────────────────────────────────────────────────
  const options_cible = CIBLES_UTILES
    .filter(id => CHORO_INDICATORS[id])
    .map(id => ({ id, label: CHORO_INDICATORS[id].label }));

  // ── Coords du périmètre ────────────────────────────────────────────────────
  const coords = perimetre_type === 'region'
    ? getCoordsForRegion(perimetre_value)
    : getCoordsForVille(perimetre_value);

  const display =
    perimetre_type === 'ville'         ? `Ville de ${perimetre_value}`
    : perimetre_type === 'agglomeration' ? `Agglomération de ${perimetre_value}`
    : perimetre_type === 'departement'   ? `Département ${perimetre_value}`
    : perimetre_type === 'region'        ? `Région ${perimetre_value}`
    :                                      `Isochrone autour de ${perimetre_value}`;

  // ── Catégories POI présentes dans la zone ─────────────────────────────────
  // On interroge les catégories globales disponibles en base, puis on filtre
  // celles qui ont au moins 1 POI dans la zone (requêtes COUNT parallèles).
  const allCategories = await getDistinctCategories();
  const supabase      = createAdminClient();

  const geoField = perimetre_type === 'region' ? 'region' : 'ville';

  const counts = await Promise.all(
    allCategories.map(async (cat) => {
      try {
        const { count } = await supabase
          .from('poi_france')
          .select('id', { count: 'exact', head: true })
          .ilike(geoField, `%${perimetre_value}%`)
          .eq('categorie', cat);
        return { cat, count: count ?? 0 };
      } catch {
        return { cat, count: 0 };
      }
    }),
  );

  const options_poi = counts
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(c => ({ id: c.cat, label: c.cat, count: c.count }));

  console.log(
    `[chat] ask_configuration(${perimetre_type}, ${perimetre_value}) → ` +
    `${options_poi.length} catégories POI, ${options_cible.length} cibles démo`,
  );

  return {
    type:      "configuration_request",
    perimetre: { type: perimetre_type, value: perimetre_value, display, coords },
    options_cible,
    options_poi,
    defaults: {
      cible: 'ind_18_24',
      poi:   options_poi.slice(0, 5).map(o => o.id),
    },
  };
}
