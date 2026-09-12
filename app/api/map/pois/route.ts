import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { resolveCategory, normVille } from '@/lib/geo/locations';
import { getDistinctCategories } from '@/lib/poi/categories';
import type { ZoneData } from '@/types/spatial';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const poisPostSchema = z.object({
  poi_types:    z.array(z.string().min(1).max(100)).min(1, 'Aucun type de POI sélectionné'),
  scope:        z.enum(['metro', 'all']).nullable().default(null),
  regions:      z.array(z.string()).default([]),
  depts:        z.array(z.string()).default([]),
  ville:        z.string().max(200).default(''),
  rayon_poi:    z.string().max(20).nullable().default(null),
  poi_natures:  z.record(z.string(), z.array(z.string())).optional(),
  // [west, south, east, north] — lib/carte/filtre.ts (Tache 4, corrigee
  // round 1). Optionnelle : useMapDirectActions ne l'envoie QUE si un filtre
  // est actif (bboxDuFiltre(filtre)) — un premier essai l'envoyait toujours
  // en repli sur BBOX_METRO, ce qui masquait 339 POI d'outre-mer et rendait
  // le scope 'all' (pill France + DROM) inerte. Absente, le comportement est
  // celui d'avant cette tache : scope/regions/depts/ville seuls decident.
  bbox:         z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

// ── Filtre org : retourne les IDs de sources autorisées pour cette session ─────
// La copie locale de `getOrgSourceIds` a été supprimée le 2026-09-11 (`DUP-002`).
// C'est une règle d'AUTORISATION — elle décide quelles sources une organisation
// voit — et elle était écrite à trois endroits identiques : ici, dans
// `app/api/map/categories/route.ts` et dans `lib/auth/getOrgSourceIds.ts`.
// Le jour où la règle évolue, en oublier une ouvrirait ou fermerait des données
// en silence. Contrat figé par `tests/unit/auth/get-org-source-ids-caracterisation.test.ts`
// AVANT la fusion, notamment la distinction entre `null` (aucun filtre) et `[]`
// (organisation sans source, donc aucun accès).
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { getRegionNameMap } from '@/lib/geo/region-lookup-server';

// Codes départements DROM (exclus en mode France métro)
const DROM_CODES = ['971', '972', '973', '974', '976'];
// Codes région INSEE des DOM (pour détection "sélection DROM" par le user)
const DROM_REGION_CODES = new Set(['01', '02', '03', '04', '06']);

const SELECT_COLS = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement';
const PAGE_SIZE   = 1000;

interface PoiRow {
  id: string; nom: string; lat: number; lng: number;
  categorie: string; sous_categorie?: string; adresse?: string; ville?: string;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parsed = poisPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join(', ') }, { status: 400 });
    }
    const { poi_types, scope, regions, depts, ville, rayon_poi, poi_natures, bbox } = parsed.data;

    const session   = await getSessionOrg(req);
    const supabase  = createAdminClient();
    const validCats = await getDistinctCategories();
    const poisMap   = new Map<string, PoiRow>();

    // ── Filtre org : sources autorisées (null = tout voir) ───────────────────
    const allowedSourceIds = await getOrgSourceIds(session);
    if (allowedSourceIds !== null && allowedSourceIds.length === 0) {
      // Org configurée mais aucune source → aucun POI accessible
      logger.debug('map/pois', 'Org sans sources configurées — résultat vide');
      return NextResponse.json({
        ville: ville ?? 'France',
        region: null, departement: null, categorie_poi: poi_types[0] ?? null,
        rayon_metres: null, rayon_poi_metres: null,
        coordonnees: { lat: 46.8, lng: 2.3 },
        pois: [], nb_pois: 0, categories: {},
      } satisfies ZoneData);
    }

    // ── Normalisation pour filtre région JS ─────────────────────────────────
    const normStr = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

    // ── helper: pagination avec retry schema cache ──────────────────────────
    interface PoiPageRow {
      id: string;
      nom?: string | null;
      lat: number | string;
      lng: number | string;
      categorie?: string | null;
      sous_categorie?: string | null;
      adresse?: string | null;
      ville?: string | null;
      region?: string | null;
      departement?: string | null;
    }
    // buildQuery returns a Supabase chained builder. Typed as `any` because
    // PostgrestFilterBuilder's deep generic chain triggers TS2589 ("Type
    // instantiation excessively deep") when narrowed.
    async function fetchAllPages(
      buildQuery: (from: number, to: number) => any,
      max = 10000,
      filter?: (p: PoiPageRow) => boolean,
    ) {
      let from = 0;
      while (from < max) {
        const to = from + PAGE_SIZE - 1;
        let data: PoiPageRow[] | null = null;
        let error: { message: string } | null = null;
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
          poisMap.set(p.id, { id: p.id, nom: p.nom ?? 'Inconnu', lat, lng, categorie: p.categorie ?? 'autre', sous_categorie: p.sous_categorie ?? undefined, adresse: p.adresse ?? undefined, ville: p.ville ?? undefined });
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
      const natures = poi_natures?.[poiType] ?? [];

      // Helper : applique cat + filtres nature + filtre org (data_source_id)
      // + bbox si presente (Tache 4, envoyee uniquement quand un filtre carte
      // est actif — voir schema ci-dessus).
      // Note: typed as `any` because Supabase's PostgrestFilterBuilder generic
      // chain causes "Type instantiation excessively deep" errors when narrowed.
      const applyFilters = (q: any): any => {
        if (resolvedCat) q = q.eq('categorie', resolvedCat);
        if (natures.length > 0) q = q.in('metadata->>libelle_nature', natures);
        if (allowedSourceIds !== null) q = q.in('data_source_id', allowedSourceIds);
        if (bbox) q = q.gte('lat', bbox[1]).lte('lat', bbox[3]).gte('lng', bbox[0]).lte('lng', bbox[2]);
        return q;
      };

      // ── Filtrage géographique ─────────────────────────────────────────────

      // 1. Par département(s)
      if (depts?.length > 0) {
        for (const dept of depts) {
          await fetchAllPages((from, to) => {
            let q = supabase.from('poi_france').select(SELECT_COLS)
              .ilike('departement', `%${dept}%`)
              .order('id')
              .range(from, to);
            return applyFilters(q);
          });
        }
        continue;
      }

      // 2. Par région(s) — JS filter (ilike Postgres ne normalise pas les accents)
      if (regions?.length > 0) {
        // Map code_region INSEE → nom_region depuis ref_regions (cache module)
        const regionNames = await getRegionNameMap(supabase);
        const regionNorms = regions.map((code: string) => normStr(regionNames.get(code) ?? code));
        // Détection "DROM sélectionné" : au moins une des régions est un DOM
        const hasDrom = regions.some((code: string) => DROM_REGION_CODES.has(code));
        const regionFilter = (p: { departement?: unknown; region?: unknown }) => {
          if (hasDrom && DROM_CODES.includes(String(p.departement))) return true;
          const pNorm = normStr(typeof p.region === 'string' ? p.region : '');
          if (!pNorm) return false; // pas de région renseignée → n'appartient à aucune région
          return regionNorms.some(rn => pNorm.includes(rn) || rn.includes(pNorm));
        };
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS).order('id').range(from, to);
          return applyFilters(q);
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
          return applyFilters(q);
        }, 4000);
        continue;
      }

      // 4. Scope national
      await fetchAllPages((from, to) => {
        let q = supabase.from('poi_france').select(SELECT_COLS).order('id').range(from, to);
        if (scope === 'metro') q = q.or(`departement.is.null,departement.not.in.(${DROM_CODES.join(',')})`);
        return applyFilters(q);
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
    else if (regions?.length === 1) {
      const regionNames = await getRegionNameMap(supabase);
      locationLabel = regionNames.get(regions[0]) ?? regions[0];
    }
    else if (regions?.length > 1) locationLabel = `${regions.length} régions`;
    else if (scope === 'metro') locationLabel = 'France métropolitaine';
    else if (scope === 'all')   locationLabel = 'France entière';

    const zoneRegionName = regions?.[0] ? (await getRegionNameMap(supabase)).get(regions[0]) ?? regions[0] : null;
    const zoneData: ZoneData = {
      ville:           locationLabel,
      region:          zoneRegionName,
      departement:     depts?.[0] ?? null,
      categorie_poi:   poi_types[0] ?? null,
      rayon_metres:    null,
      rayon_poi_metres: rayonPoiM,
      coordonnees,
      pois,
      nb_pois:         pois.length,
      categories,
    };

    logger.debug('api/map/pois', `${pois.length} POIs — types: ${poi_types.join(', ')} — lieu: ${locationLabel}`);
    return NextResponse.json(zoneData);

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[api/map/pois] ERREUR:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
