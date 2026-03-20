import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { resolveCategory, normVille } from '@/lib/geo/locations';
import { getDistinctCategories } from '@/lib/poi/categories';
import type { ZoneData } from '@/types/spatial';

// Mapping FilterPanel region IDs → noms DB
const REGION_ID_TO_NAME: Record<string, string> = {
  ara: 'Auvergne-Rhone-Alpes',
  bfc: 'Bourgogne-Franche-Comte',
  bre: 'Bretagne',
  cvl: 'Centre-Val de Loire',
  cor: 'Corse',
  ges: 'Grand Est',
  hdf: 'Hauts-de-France',
  idf: 'Ile-de-France',
  nor: 'Normandie',
  naq: 'Nouvelle-Aquitaine',
  occ: 'Occitanie',
  pdl: 'Pays de la Loire',
  pac: 'Provence-Alpes-Cote d\'Azur',
  dom: 'DROM',
};

// Codes départements DROM (exclus en mode France métro)
const DROM_CODES = ['971', '972', '973', '974', '976'];

const SELECT_COLS = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement';
const PAGE_SIZE   = 1000;

interface PoiRow {
  id: string; nom: string; lat: number; lng: number;
  categorie: string; sous_categorie?: string; adresse?: string; ville?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      poi_types,          // string[]  — labels FilterPanel (ex: ['CIRFA','Lycées'])
      scope,              // 'metro' | 'all' | null
      regions,            // string[]  — region IDs (ex: ['bre','nor'])
      depts,              // string[]  — dept codes (ex: ['29','35'])
      ville,              // string
      rayon_poi,          // string | null  (ex: '2km')
    } = body as {
      poi_types: string[];
      scope: 'metro' | 'all' | null;
      regions: string[];
      depts: string[];
      ville: string;
      rayon_poi: string | null;
    };

    if (!poi_types?.length) {
      return NextResponse.json({ error: 'Aucun type de POI sélectionné' }, { status: 400 });
    }

    const supabase  = createAdminClient();
    const validCats = await getDistinctCategories();
    const poisMap   = new Map<string, PoiRow>();

    // ── Normalisation pour filtre région JS ─────────────────────────────────
    const normStr = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

    // ── helper: pagination avec retry schema cache ──────────────────────────
    async function fetchAllPages(
      buildQuery: (from: number, to: number) => any,
      max = 10000,
      filter?: (p: any) => boolean,
    ) {
      let from = 0;
      while (from < max) {
        const to = from + PAGE_SIZE - 1;
        let data: any[] | null = null;
        let error: any = null;
        // Retry jusqu'à 3× si erreur schema cache (cold start Supabase PostgREST)
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await Promise.race([
            buildQuery(from, to),
            new Promise<{ data: null; error: { message: string } }>(resolve =>
              setTimeout(() => resolve({ data: null, error: { message: 'DB timeout (20s)' } }), 20000)
            ),
          ]);
          ({ data, error } = result);
          if (!error || !String(error.message).includes('schema cache')) break;
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        }
        if (error) {
          console.error('[map/pois] pagination error:', error.message);
          if (String(error.message).includes('timeout')) throw new Error('Base de données temporairement indisponible — réessayez dans quelques instants');
          break;
        }
        if (!data?.length) break;
        for (const p of data) {
          if (filter && !filter(p)) continue;
          const lat = Number(p.lat), lng = Number(p.lng);
          if (isNaN(lat) || isNaN(lng)) continue;
          poisMap.set(p.id, { id: p.id, nom: p.nom ?? 'Inconnu', lat, lng, categorie: p.categorie ?? 'autre', sous_categorie: p.sous_categorie, adresse: p.adresse, ville: p.ville });
        }
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    // ── rayon_poi → mètres ──────────────────────────────────────────────────
    const rayonPoiM = rayon_poi
      ? rayon_poi.endsWith('km')
        ? parseFloat(rayon_poi) * 1000
        : parseFloat(rayon_poi)
      : null;

    // ── Pour chaque type de POI sélectionné ────────────────────────────────
    for (const poiType of poi_types) {
      const resolvedCat = resolveCategory(poiType, validCats);

      // ── Filtrage géographique ─────────────────────────────────────────────

      // 1. Par département(s)
      if (depts?.length > 0) {
        for (const dept of depts) {
          await fetchAllPages((from, to) => {
            let q = supabase.from('poi_france').select(SELECT_COLS)
              .ilike('departement', `%${dept}%`)
              .order('id')
              .range(from, to);
            if (resolvedCat) q = q.eq('categorie', resolvedCat);
            return q;
          });
        }
        continue;
      }

      // 2. Par région(s) — JS filter (ilike Postgres ne normalise pas les accents)
      if (regions?.length > 0) {
        const regionNorms = regions.map(id => normStr(REGION_ID_TO_NAME[id] ?? id));
        const hasDom = regions.includes('dom');
        const regionFilter = (p: any) => {
          if (hasDom && DROM_CODES.includes(String(p.departement))) return true;
          const pNorm = normStr(p.region ?? '');
          if (!pNorm) return false; // pas de région renseignée → n'appartient à aucune région
          return regionNorms.some(rn => pNorm.includes(rn) || rn.includes(pNorm));
        };
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS).order('id').range(from, to);
          if (resolvedCat) q = q.eq('categorie', resolvedCat);
          return q;
        }, 10000, regionFilter);
        continue;
      }

      // 3. Par ville
      if (ville?.trim()) {
        const villeKey = normVille(ville.trim());
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS)
            .ilike('ville', `%${villeKey}%`)
            .order('id')
            .range(from, to);
          if (resolvedCat) q = q.eq('categorie', resolvedCat);
          return q;
        }, 4000);
        continue;
      }

      // 4. Scope national
      await fetchAllPages((from, to) => {
        let q = supabase.from('poi_france').select(SELECT_COLS).order('id').range(from, to);
        if (resolvedCat) q = q.eq('categorie', resolvedCat);
        if (scope === 'metro') q = q.or(`departement.is.null,departement.not.in.(${DROM_CODES.join(',')})`);
        return q;
      }, 10000);
    }

    // ── Résumé ─────────────────────────────────────────────────────────────
    const pois = Array.from(poisMap.values());
    const categories: Record<string, number> = {};
    for (const p of pois) {
      const cat = p.categorie || 'autre';
      categories[cat] = (categories[cat] ?? 0) + 1;
    }

    // Centroïde
    const coordonnees = pois.length > 0
      ? {
          lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length,
          lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length,
        }
      : { lat: 46.8, lng: 2.3 };

    // Label lieu
    let locationLabel = 'France';
    if (ville?.trim()) locationLabel = ville.trim();
    else if (depts?.length === 1) locationLabel = `Département ${depts[0]}`;
    else if (depts?.length > 1) locationLabel = `${depts.length} départements`;
    else if (regions?.length === 1) locationLabel = REGION_ID_TO_NAME[regions[0]] ?? regions[0];
    else if (regions?.length > 1) locationLabel = `${regions.length} régions`;
    else if (scope === 'metro') locationLabel = 'France métropolitaine';
    else if (scope === 'all')   locationLabel = 'France entière';

    const zoneData: ZoneData = {
      ville:           locationLabel,
      region:          regions?.[0] ? REGION_ID_TO_NAME[regions[0]] : null,
      departement:     depts?.[0] ?? null,
      categorie_poi:   poi_types[0] ?? null,
      rayon_metres:    null,
      rayon_poi_metres: rayonPoiM,
      coordonnees,
      pois,
      nb_pois:         pois.length,
      categories,
    };

    console.log(`[api/map/pois] ${pois.length} POIs — types: ${poi_types.join(', ')} — lieu: ${locationLabel}`);
    return NextResponse.json(zoneData);

  } catch (err: any) {
    console.error('[api/map/pois] ERREUR:', err?.message ?? err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
