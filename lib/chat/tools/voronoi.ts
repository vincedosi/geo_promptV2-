/**
 * lib/chat/tools/voronoi.ts
 * Outil voronoi_analysis — polygones de Voronoï / zones d'influence territoriales.
 */

import { createAdminClient } from '@/lib/auth';
import { logger } from '@/lib/logger';
import type { VoronoiFeature } from './types';

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

  const rpcArgs: Record<string, unknown> = { cat_name: category, metropolitaine };
  if (filtre_ville)  rpcArgs.filtre_ville       = filtre_ville;
  if (filtre_region) rpcArgs.filtre_region      = filtre_region;
  if (filtre_dept)   rpcArgs.filtre_departement = filtre_dept;

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_voronoi_by_category', rpcArgs);

  if (error) {
    console.error('[chat/voronoi] RPC error:', error.message);
    return { error: error.message, nb_polygones: 0, category };
  }

  const features = Array.isArray(data) ? (data as VoronoiFeature[]) : [];
  logger.debug('chat/voronoi', `"${category}" metro=${metropolitaine} ville=${filtre_ville} region=${filtre_region} dept=${filtre_dept} → ${features.length} polygones`);

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
    category,
    metropolitaine,
  };
}
