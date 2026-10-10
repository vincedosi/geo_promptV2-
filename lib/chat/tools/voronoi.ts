/**
 * lib/chat/tools/voronoi.ts
 * Outil voronoi_analysis — polygones de Voronoï / zones d'influence territoriales.
 */

import { createAdminClient } from '@/lib/auth';
import { logger } from '@/lib/logger';
import type { VoronoiFeature } from './types';
import { getOrgSourceIds } from './orgContext';
import { categorieEntierementVisible } from '@/lib/auth/perimetre-donnees';
import { rpcJson } from '@/lib/supabase/rpc-json';

/**
 * Borne du nombre de cellules, passée à `get_voronoi_by_category_jsonb`
 * (sql/246). C'est le `LIMIT 5000` historique de sql/164. La jumelle rend du
 * jsonb : relever cette borne ne ramène AUCUNE troncature PostgREST, mais
 * chaque cellule coûte une intersection contre la frontière (14 s pour les
 * 4 653 cellules des lycées, mesuré le 2026-10-10).
 */
const BORNE_CELLULES = 5000;

export async function voronoiAnalysis(
  args:            Record<string, unknown>,
  _validCategories: string[],
) {
  const category = args.category ? String(args.category) : '';
  if (!category) return { error: 'category requis pour voronoi_analysis' };

  const metropolitaine = args.metropolitaine !== false;
  const filtre_ville   = args.ville       ? String(args.ville)       : null;
  const filtre_region  = args.region      ? String(args.region)      : null;
  const filtre_dept    = args.departement ? String(args.departement) : null;

  const supabase = createAdminClient();
  // La RPC rend les POI de TOUTE la catégorie (id, nom, coordonnées), sans
  // notion de source : on ne la lance que si l'appelant les voit tous.
  if (!(await categorieEntierementVisible(supabase, category, getOrgSourceIds()))) {
    return { error: `Catégorie « ${category} » hors de votre périmètre de données.`, nb_polygones: 0, category };
  }
  // `_jsonb` et non `get_voronoi_by_category` (RETURNS SETOF json) : PostgREST
  // coupe à `db-max-rows` = 1 000 lignes toute RPC tabulaire, sans erreur.
  // Mesuré le 2026-10-10 sur les lycées de métropole : 4 653 cellules en base,
  // 1 000 rendues par la forme SETOF. La jumelle (sql/246) rend tout, jusqu'à
  // sa borne `p_limite` — et dit `tronque` quand elle l'atteint.
  const { data, error } = await supabase.rpc('get_voronoi_by_category_jsonb', {
    cat_name: category,
    metropolitaine,
    p_limite: BORNE_CELLULES,
    ...(filtre_ville  ? { filtre_ville }                      : {}),
    ...(filtre_region ? { filtre_region }                     : {}),
    ...(filtre_dept   ? { filtre_departement: filtre_dept }   : {}),
  });

  if (error) {
    console.error('[chat/voronoi] RPC error:', error.message);
    return { error: error.message, nb_polygones: 0, category };
  }

  const reponse = rpcJson<{ features?: VoronoiFeature[]; tronque?: boolean }>(data);
  const features = Array.isArray(reponse?.features) ? reponse.features : [];
  const tronque = reponse?.tronque === true;
  logger.debug('chat/voronoi', `"${category}" metro=${metropolitaine} ville=${filtre_ville} region=${filtre_region} dept=${filtre_dept} → ${features.length} polygones${tronque ? ' (borne atteinte)' : ''}`);

  const pois = features
    .map(f => ({
      id:        f.properties?.id        ?? String(Math.random()),
      nom:       f.properties?.nom       ?? 'Inconnu',
      lat:       Number(f.properties?.lat ?? 0),
      lng:       Number(f.properties?.lng ?? 0),
      categorie: f.properties?.categorie ?? category,
      adresse:   f.properties?.adresse   ?? undefined,
      ville:     f.properties?.ville     ?? undefined,
    }))
    .filter(p => p.lat !== 0 && p.lng !== 0);

  const locationLabel = filtre_ville ?? filtre_region ?? filtre_dept
    ?? (metropolitaine ? 'France métropolitaine' : 'France');

  const coordonnees = pois.length > 0
    ? {
        lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length,
        lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length,
      }
    : { lat: 46.8, lng: 2.3 };

  return {
    voronoiGeoJSON: {
      type: 'FeatureCollection' as const,
      features,
      _meta: { category, metropolitaine, filtre_ville, filtre_region, filtre_dept },
    },
    poisForMap: {
      ville:            locationLabel,
      region:           filtre_region ?? null,
      departement:      filtre_dept   ?? null,
      categorie_poi:    category,
      rayon_metres:     null,
      rayon_poi_metres: null,
      coordonnees,
      pois,
      nb_pois:          pois.length,
      categories:       { [category]: pois.length },
    },
    nb_polygones: features.length,
    /** Vrai si la catégorie a plus de cellules que `BORNE_CELLULES` : le compte n'est pas le total. */
    tronque,
    category,
    metropolitaine,
  };
}
