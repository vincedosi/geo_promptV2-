/**
 * lib/geo/fetchPois.ts
 *
 * Fetch POIs depuis poi_france avec filtres géographiques.
 * Reproduit exactement la logique multi-requêtes du chat route :
 *   - region  → ilike sur colonne region (normalisée)
 *   - departement → or(departement ilike, code_departement eq)
 *   - ville   → ilike sur colonne ville
 *   - aucun   → tous les POIs de la catégorie
 * Les résultats sont dédupliqués par id.
 */

import type { PoiRow } from '@/lib/isochrones/fetcher';

const SELECT_COLS = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville';

function normStr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export async function fetchPois(
  supabase: any,
  resolvedCategory: string | null,
  poi_category: string,
  opts: {
    region?:      string | null;
    ville?:       string | null;
    departement?: string | null;
    limit?:       number;
  }
): Promise<{ pois: PoiRow[]; error: string | null }> {
  const { region = null, ville = null, departement = null, limit = 5000 } = opts;
  const poisMap = new Map<string, PoiRow>();

  function addRows(data: any[]) {
    for (const p of data) {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      if (isNaN(lat) || isNaN(lng)) continue;
      poisMap.set(String(p.id), {
        id:            p.id,
        nom:           p.nom ?? 'Inconnu',
        lat, lng,
        categorie:     p.categorie ?? poi_category,
        sous_categorie: p.sous_categorie,
        adresse:       p.adresse,
        ville:         p.ville,
      });
    }
  }

  try {
    // ── Requête par REGION ──────────────────────────────────────────────
    if (region) {
      const regionNorm = normStr(region);
      let q = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${regionNorm}%`);
      if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
      const { data, error } = await q.limit(limit);
      if (error) console.error('[fetchPois] region query:', error.message);
      else addRows(data ?? []);
    }

    // ── Requête par DEPARTEMENT ─────────────────────────────────────────
    if (departement) {
      let q = supabase.from('poi_france').select(SELECT_COLS)
        .or(`departement.ilike.%${departement}%,code_departement.eq.${departement}`);
      if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
      const { data, error } = await q.limit(limit);
      if (error) console.error('[fetchPois] departement query:', error.message);
      else addRows(data ?? []);
    }

    // ── Requête par VILLE ───────────────────────────────────────────────
    if (ville) {
      const villeNorm = normStr(ville);
      let q = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${villeNorm}%`);
      if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
      const { data, error } = await q.limit(limit);
      if (error) console.error('[fetchPois] ville query:', error.message);
      else addRows(data ?? []);
    }

    // ── Fallback : aucun filtre geo → tous les POIs de la catégorie ─────
    if (!region && !ville && !departement) {
      let q = supabase.from('poi_france').select(SELECT_COLS);
      if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
      const { data, error } = await q.limit(limit);
      if (error) {
        console.error('[fetchPois] all query:', error.message);
        return { pois: [], error: error.message };
      }
      addRows(data ?? []);
    }

    return { pois: Array.from(poisMap.values()), error: null };
  } catch (e: any) {
    return { pois: [], error: e.message ?? 'Fetch POIs error' };
  }
}
