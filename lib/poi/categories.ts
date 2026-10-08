/**
 * GENESIS — lib/poi/categories.ts
 * Dictionnaire dynamique des catégories POI.
 * Fait un SELECT DISTINCT categorie FROM poi ultra-rapide
 * et cache le résultat 60 secondes côté serveur.
 */
import { createAdminClient } from '@/lib/auth';
import { logger } from '@/lib/logger';

let cachedCategories: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 300_000; // 5 minutes — les catégories changent rarement en cours de session

/**
 * Récupère toutes les catégories distinctes de la table poi.
 * Résultat mis en cache 60s pour éviter de requêter à chaque appel.
 */
export async function getDistinctCategories(): Promise<string[]> {
  const now = Date.now();
  if (cachedCategories && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCategories;
  }

  const supabase = createAdminClient();
  const catSet = new Set<string>();

  // Leapfrog : une requête par valeur distincte (O(N_catégories) au lieu de O(N_lignes/1000))
  // Principe : SELECT categorie WHERE categorie > $lastSeen ORDER BY categorie LIMIT 1
  // Sur index, chaque requête est instantanée (~5ms). Avec ~15 catégories → ~15 requêtes.
  let lastSeen = '';
  for (let i = 0; i < 100; i++) {
    let data: { categorie: string }[] | null = null;
    let error: { message?: string } | null = null;
    // Retry jusqu'à 3× si erreur schema cache (cold start Supabase PostgREST)
    for (let attempt = 0; attempt < 3; attempt++) {
      ({ data, error } = await supabase
        .from('poi_france')
        .select('categorie')
        .gt('categorie', lastSeen)
        .neq('categorie', 'arret_transport')
        .order('categorie', { ascending: true })
        .limit(1));
      if (!error || !String(error.message).includes('schema cache')) break;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // 500ms / 1s / 1.5s (était 1.5s / 3s / 4.5s)
    }

    if (error) {
      console.error('[categories] Supabase error:', error.message);
      return cachedCategories ?? [];
    }
    if (!data?.length) break;
    const cat = data[0].categorie as string;
    catSet.add(cat);
    lastSeen = cat;
  }

  const categories = [...catSet].sort();
  cachedCategories = categories;
  cacheTimestamp = now;

  logger.debug('categories', `Refreshed (leapfrog): ${categories.length} catégories → ${categories.join(', ')}`);
  return categories;
}

/**
 * Les catégories que l'appelant a le droit de connaître.
 *
 * `getDistinctCategories` rend TOUTES les catégories, celles des autres
 * clients comprises : son résultat sert au contrôle interne (résoudre un nom
 * de catégorie), jamais à l'affichage. Ce qui est montré ou dicté à l'IA passe
 * par ici — un nom de catégorie (« bmw ») suffit à révéler qu'un client existe.
 *
 * Extrait de `app/api/map/categories/route.ts` le 2026-10-08, à l'identique,
 * pour que le chat applique la même règle.
 *
 * @param sources - Le retour de `getOrgSourceIds` : `null` = super_admin.
 * @returns Les catégories dans l'ordre de `getDistinctCategories`.
 */
export async function getCategoriesVisibles(sources: string[] | null): Promise<string[]> {
  const toutes = await getDistinctCategories();
  if (sources === null) return toutes;
  if (sources.length === 0) return [];

  // Leapfrog restreint aux sources visibles : une requête par catégorie
  // présente, sur l'index de `categorie`.
  const supabase = createAdminClient();
  const visibles = new Set<string>();
  let lastSeen = '';
  for (let i = 0; i < 100; i++) {
    const { data, error } = await supabase
      .from('poi_france')
      .select('categorie')
      .in('data_source_id', sources)
      .not('categorie', 'is', null)
      .gt('categorie', lastSeen)
      .order('categorie', { ascending: true })
      .limit(1);
    // Une lecture en échec ferme : on rend ce qu'on a pu vérifier, rien de plus.
    if (error || !data?.length) break;
    const cat = data[0].categorie as string;
    visibles.add(cat);
    lastSeen = cat;
  }
  return toutes.filter((c) => visibles.has(c));
}

/**
 * Force le rafraîchissement du cache (après un import par exemple).
 */
export function invalidateCategoriesCache(): void {
  cachedCategories = null;
  cacheTimestamp = 0;
}
