/**
 * @file lib/poi/libelles-categories.ts — libellés français des catégories de POI.
 * Extrait de `app/api/map/categories/route.ts` (comportement identique), pour que d'autres routes les réutilisent.
 */
import type { createAdminClient } from '@/lib/auth';

type Sb = ReturnType<typeof createAdminClient>;

/** Map catégorie → label_fr depuis poi_categories (1 requête légère). */
export async function libellesCategories(supabase: Sb, cats: string[]): Promise<Record<string, string>> {
  if (cats.length === 0) return {};
  const { data } = await supabase
    .from('poi_categories')
    .select('categorie, label_fr')
    .in('categorie', cats);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.label_fr) map[row.categorie] = row.label_fr;
  }
  return map;
}

/** string[] → {id, label}[] en utilisant label_fr si disponible. */
export function avecLibelles(cats: string[], libelles: Record<string, string>): { id: string; label: string }[] {
  return cats.map(c => ({
    id: c,
    label: libelles[c] ?? (c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')),
  }));
}
