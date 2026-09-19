/**
 * Lookup côté serveur des régions INSEE.
 *
 * Remplace les tables REGION_ID_TO_NAME hardcodées dans les routes API
 * (isochrone-battle / v2 / cache-check / pois). Source : ref_regions.
 *
 * Cache module-level : 1 fetch au 1er appel, puis tous les appels lisent
 * la valeur mémoire. Invalidé à chaque restart serveur (rarement utile —
 * les codes INSEE des régions changent ~1 fois par décennie).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface RegionRow { code_region: string; nom_region: string }

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

/**
 * Retourne la map `code_region INSEE → nom_region`.
 *
 * Usage côté routes API :
 *   const regionNames = await getRegionNameMap(supabase);
 *   const regionNorms = regions.map(r => normStr(regionNames.get(r) ?? r));
 */
export async function getRegionNameMap(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;

  const run = async (): Promise<Map<string, string>> => {
    const { data, error } = await supabase
      .from('ref_regions')
      .select('code_region, nom_region');
    if (error) {
      console.error('[region-lookup]', error.message);
      return new Map<string, string>();
    }
    const m = new Map<string, string>();
    for (const r of (data as RegionRow[] | null) ?? []) {
      m.set(r.code_region, r.nom_region);
    }
    cache = m;
    return m;
  };

  inflight = run();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Toutes les écritures sous lesquelles une région peut apparaître dans
 * `poi_france.region`, pour un code INSEE demandé.
 *
 * POURQUOI PLUSIEURS ÉCRITURES
 * Mesuré le 2026-09-13 : l'Île-de-France est stockée sous DEUX orthographes
 * — `Ile-de-France` sur 981 POI et `Île-de-France` sur 34. C'est ce qui
 * justifiait le filtrage en JavaScript après normalisation ; ici on génère les
 * variantes à l'avance pour que le filtre parte en SQL et se serve de
 * `idx_poi_france_region`.
 *
 * Fonction PURE, testée sans base.
 */
export function ecrituresDeLaRegion(
  code: string,
  nomsParCode: Map<string, string>,
): string[] {
  const brut = code.trim();
  if (!brut) return [];

  const ecritures = new Set<string>([brut]);

  const nom = nomsParCode.get(brut);
  if (nom) {
    ecritures.add(nom);
    // Variante sans accent : c'est exactement l'écart mesuré entre
    // `Île-de-France` (référentiel) et `Ile-de-France` (981 POI).
    const sansAccent = nom.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (sansAccent !== nom) ecritures.add(sansAccent);
  }

  return [...ecritures].filter((e) => e.length > 0);
}

/** Invalidation manuelle (utile uniquement si ref_regions change en runtime). */
export function invalidateRegionCache(): void {
  cache = null;
}
