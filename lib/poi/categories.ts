/**
 * GENESIS — lib/poi/categories.ts
 * Dictionnaire dynamique des catégories POI.
 * Fait un SELECT DISTINCT categorie FROM poi ultra-rapide
 * et cache le résultat 60 secondes côté serveur.
 */
import { createAdminClient } from '@/lib/auth';

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
    let data: any[] | null = null;
    let error: any = null;
    // Retry jusqu'à 3× si erreur schema cache (cold start Supabase PostgREST)
    for (let attempt = 0; attempt < 3; attempt++) {
      ({ data, error } = await supabase
        .from('poi_france')
        .select('categorie')
        .gt('categorie', lastSeen)
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

  console.log(`[categories] Refreshed (leapfrog): ${categories.length} catégories →`, categories.join(', '));
  return categories;
}

/**
 * Force le rafraîchissement du cache (après un import par exemple).
 */
export function invalidateCategoriesCache(): void {
  cachedCategories = null;
  cacheTimestamp = 0;
}
