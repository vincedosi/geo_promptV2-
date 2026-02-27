/**
 * GENESIS — lib/poi/categories.ts
 * Dictionnaire dynamique des catégories POI.
 * Fait un SELECT DISTINCT categorie FROM poi ultra-rapide
 * et cache le résultat 60 secondes côté serveur.
 */
import { createAdminClient } from '@/lib/auth';

let cachedCategories: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 secondes

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
  let from = 0;
  const batchSize = 1000;

  // Paginer sur TOUTES les lignes pour ne rater aucune catégorie
  // (ex: CIRAF importé après la 1000ème ligne serait invisible sans pagination)
  while (true) {
    const { data, error } = await supabase
      .from('poi_france')
      .select('categorie')
      .not('categorie', 'is', null)
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('[categories] Supabase error:', error.message);
      return cachedCategories ?? [];
    }
    if (!data || data.length === 0) break;

    data.forEach((row: { categorie: string }) => { if (row.categorie) catSet.add(row.categorie); });
    from += batchSize;
    if (data.length < batchSize) break; // dernier batch
  }

  const categories = [...catSet].sort();
  cachedCategories = categories;
  cacheTimestamp = now;

  console.log(`[categories] Refreshed (${from} rows scannées): ${categories.length} catégories →`, categories.join(', '));
  return categories;
}

/**
 * Force le rafraîchissement du cache (après un import par exemple).
 */
export function invalidateCategoriesCache(): void {
  cachedCategories = null;
  cacheTimestamp = 0;
}
