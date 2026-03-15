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
    region?:       string | null;
    regions?:      string[] | null;
    ville?:        string | null;
    departement?:  string | null;
    departements?: string[] | null;
    limit?:        number;
  }
): Promise<{ pois: PoiRow[]; error: string | null }> {
  const { regions = null, region = null, ville = null, departement = null, departements = null, limit = 5000 } = opts;
  // Normalize: regions array takes priority over legacy single region
  const regionList: string[] | null = (Array.isArray(regions) && regions.length > 0)
    ? regions
    : (region ? [region] : null);
  // Dept codes array (expanded from regions) takes priority over single departement
  const deptList: string[] | null = (Array.isArray(departements) && departements.length > 0)
    ? departements
    : (departement ? [departement] : null);
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
    // ── Requête par DEPARTEMENT(S) ──────────────────────────────────────
    if (deptList && deptList.length > 0) {
      // Query each dept via ilike on departement column (code_departement unreliable)
      for (const code of deptList) {
        let qf = supabase.from('poi_france').select(SELECT_COLS)
          .or(`departement.ilike.%${code}%,code_departement.eq.${code}`);
        if (resolvedCategory) qf = qf.eq('categorie', resolvedCategory);
        const { data: fd } = await qf.limit(limit);
        addRows(fd ?? []);
      }
      console.log(`[fetchPois] departements (${deptList.length} codes) → ${poisMap.size} POIs`);
    }

    // ── Requête par REGION(S) — uniquement si pas de deptList ──────────
    // regionList contient les noms complets (ex: "Auvergne-Rhône-Alpes")
    // On utilise .in() pour un match exact — plus fiable que ilike sur noms accentués
    if (!deptList && regionList && regionList.length > 0) {
      let q = supabase.from('poi_france').select(SELECT_COLS).in('region', regionList);
      if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
      const { data, error } = await q.limit(limit);
      if (error) {
        console.error('[fetchPois] region .in() query:', error.message);
        // Fallback: ilike par région individuelle (sans normalisation des accents)
        for (const reg of regionList) {
          let qr = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${reg}%`);
          if (resolvedCategory) qr = qr.eq('categorie', resolvedCategory);
          const { data: rd } = await qr.limit(limit);
          addRows(rd ?? []);
        }
      } else {
        addRows(data ?? []);
      }
      console.log(`[fetchPois] regions (${regionList.length}) → ${poisMap.size} POIs`);

      // Fallback: si aucun résultat et une seule région (cas confusion région/ville)
      if (poisMap.size === 0 && regionList.length === 1) {
        const regionNorm = normStr(regionList[0]);
        let qv = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${regionNorm}%`);
        if (resolvedCategory) qv = qv.eq('categorie', resolvedCategory);
        const { data: vd } = await qv.limit(limit);
        if (vd?.length) console.log(`[fetchPois] region→ville fallback: ${vd.length} résultats pour "${regionList[0]}"`);
        addRows(vd ?? []);
      }
    }

    // ── Requête par VILLE ───────────────────────────────────────────────
    if (ville) {
      const villeNorm = normStr(ville);
      let q = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${villeNorm}%`);
      if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
      const { data, error } = await q.limit(limit);
      if (error) console.error('[fetchPois] ville query:', error.message);
      else addRows(data ?? []);

      // Fallback: si l'IA a passé un nom de région dans le champ ville (confusion fréquente)
      if (poisMap.size === 0 && !regionList) {
        let qr = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${villeNorm}%`);
        if (resolvedCategory) qr = qr.eq('categorie', resolvedCategory);
        const { data: rd } = await qr.limit(limit);
        if (rd?.length) console.log(`[fetchPois] ville→region fallback: ${rd.length} résultats pour "${ville}"`);
        addRows(rd ?? []);
      }
    }

    // ── Fallback : aucun filtre geo → tous les POIs de la catégorie ─────
    if (!regionList && !deptList && !ville && !departement) {
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
