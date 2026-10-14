/**
 * GENESIS — lib/poi/categories.ts
 * Dictionnaire dynamique des catégories POI.
 * Fait un SELECT DISTINCT categorie FROM poi ultra-rapide
 * et cache le résultat 60 secondes côté serveur.
 */
import { createAdminClient } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { empreintePerimetre } from '@/lib/auth/perimetre-donnees';

let cachedCategories: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 300_000; // 5 minutes — les catégories changent rarement en cours de session

/**
 * Catégories visibles, par empreinte de périmètre (`empreintePerimetre`).
 *
 * Sans lui, chaque appel de `getCategoriesVisibles` pour un client ou un
 * appelant sans session relisait ≈ 35 000 pages (≈ 270 Mo, EXPLAIN BUFFERS du
 * 2026-10-09) — et `/api/map/categories` est une route PUBLIQUE. Même TTL que
 * le cache global ; borné à `CACHE_VISIBLES_MAX` entrées, la plus ancienne
 * évincée d'abord (ordre d'insertion d'une Map). Un cache de processus suffit :
 * il protège la base de la répétition, il ne compte pas un quota.
 */
const cacheVisibles = new Map<string, { categories: string[]; t: number }>();
const CACHE_VISIBLES_MAX = 200;

/**
 * Récupère toutes les catégories distinctes de la table poi.
 * Résultat mis en cache 60s pour éviter de requêter à chaque appel.
 *
 * `strict` : une lecture en échec LÈVE (message français) au lieu de rendre le
 * cache ou []. Sans l'option (chat, carte), le comportement est inchangé.
 *
 * `surEchec` : appelé quand une lecture échoue SANS `strict` — le résultat rendu
 * (cache ou []) est alors peut-être incomplet. Il ne change rien au résultat ni
 * au cache : il permet à un appelant de le savoir sans contourner le cache comme
 * le ferait `strict` (Accès › sélection recommandée, carte-en-parcours T11).
 */
export async function getDistinctCategories(options: { strict?: boolean; surEchec?: () => void } = {}): Promise<string[]> {
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
      if (options.strict) throw new Error(`lecture des catégories : ${error.message}`);
      options.surEchec?.();
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
 * @param sources - Le retour de `getOrgSourceIds` : `null` = aucun filtre
 *   (super_admin HORS vue espace, c'est-à-dire administration seulement ; la
 *   carte et le chat passent `{ vueEspace: true }` et n'envoient jamais `null`).
 * @param options.strict - Lever sur une lecture en échec au lieu de rendre une liste partielle.
 * @param options.surEchec - Appelé si une lecture échoue sans `strict` (liste rendue peut-être partielle).
 * @returns Les catégories dans l'ordre de `getDistinctCategories`.
 */
export async function getCategoriesVisibles(
  sources: string[] | null,
  options: { strict?: boolean; surEchec?: () => void } = {},
): Promise<string[]> {
  const toutes = await getDistinctCategories(options);
  if (sources === null) return toutes;
  if (sources.length === 0) return [];

  // `strict` (aperçu d'un espace) relit toujours : il doit dire l'état présent.
  const cle = empreintePerimetre(sources);
  const enCache = cacheVisibles.get(cle);
  if (!options.strict && enCache && Date.now() - enCache.t < CACHE_TTL_MS) {
    return enCache.categories;
  }

  // Leapfrog restreint aux sources visibles : une requête par catégorie
  // présente, sur l'index de `categorie`.
  const supabase = createAdminClient();
  const visibles = new Set<string>();
  let complet = true;
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
    // Une lecture en échec ferme : on rend ce qu'on a pu vérifier, rien de plus
    // — sauf en mode `strict`, où elle lève (un aperçu ne doit pas mentir).
    if (error && options.strict) throw new Error(`lecture des catégories visibles : ${error.message}`);
    if (error) { complet = false; options.surEchec?.(); break; }
    if (!data?.length) break;
    const cat = data[0].categorie as string;
    visibles.add(cat);
    lastSeen = cat;
  }
  const resultat = toutes.filter((c) => visibles.has(c));
  // Une liste partielle (lecture en échec) n'est jamais mise en cache.
  if (complet) {
    cacheVisibles.delete(cle);
    cacheVisibles.set(cle, { categories: resultat, t: Date.now() });
    while (cacheVisibles.size > CACHE_VISIBLES_MAX) {
      const plusAncienne = cacheVisibles.keys().next().value;
      if (plusAncienne === undefined) break;
      cacheVisibles.delete(plusAncienne);
    }
  }
  return resultat;
}

/**
 * Force le rafraîchissement du cache (après un import par exemple).
 */
export function invalidateCategoriesCache(): void {
  cachedCategories = null;
  cacheTimestamp = 0;
  cacheVisibles.clear();
}
