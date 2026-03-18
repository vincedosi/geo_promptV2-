/**
 * Utilitaires de gestion de l'historique de conversation.
 * Séparés de route.ts pour être testables.
 */

const MAX_MESSAGES = 14; // 7 échanges complets
const KEEP_INTACT  = 4;  // 2 derniers échanges préservés intacts

/**
 * Supprime les champs volumineux des anciens tool results.
 * pois[], isochroneGeoJSON, voronoiGeoJSON.features, etc. peuvent peser 50k+ tokens.
 */
export function stripHeavyFields(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  let r = result as Record<string, unknown>;

  // Strip pois[]
  if (Array.isArray(r.pois)) {
    const { pois, ...rest } = r;
    r = { ...rest, pois: [], nb_pois: (pois as unknown[]).length, _stripped: true };
  }

  // Strip isochroneGeoJSON (polygones ORS — très volumineux)
  if (r.isochroneGeoJSON && typeof r.isochroneGeoJSON === 'object') {
    const geo = r.isochroneGeoJSON as Record<string, unknown>;
    const nb = Array.isArray(geo.features) ? geo.features.length : 1;
    r = { ...r, isochroneGeoJSON: { _stripped: true, nb_features: nb } };
  }

  // Strip voronoiGeoJSON.features
  if (r.voronoiGeoJSON && typeof r.voronoiGeoJSON === 'object') {
    const vgeo = r.voronoiGeoJSON as Record<string, unknown>;
    if (Array.isArray(vgeo.features)) {
      const nb = vgeo.features.length;
      r = { ...r, voronoiGeoJSON: { ...vgeo, features: [], nb_features: nb, _stripped: true } };
    }
  }

  // Strip poisForMap.pois (voronoi_analysis)
  if (r.poisForMap && typeof r.poisForMap === 'object') {
    const pm = r.poisForMap as Record<string, unknown>;
    if (Array.isArray(pm.pois)) {
      const nb = pm.pois.length;
      r = { ...r, poisForMap: { ...pm, pois: [], nb_pois: nb, _stripped: true } };
    }
  }

  // Strip isochrone_battle features[]
  if (Array.isArray(r.features) && r.features.length > 0) {
    const first = r.features[0] as Record<string, unknown>;
    if (first?.geometry) {
      r = { ...r, features: [], nb_features: r.features.length, _stripped: true };
    }
  }

  return r;
}

/**
 * Limite l'historique à MAX_MESSAGES messages et strip les champs lourds
 * des tool results anciens pour réduire la consommation de tokens.
 */
export function trimHistory(messages: unknown[]): unknown[] {
  const recent = messages.slice(-MAX_MESSAGES);

  return recent.map((msg: unknown, idx: number) => {
    const m = msg as Record<string, unknown>;
    const isLast = idx >= recent.length - KEEP_INTACT;
    if (isLast) return m;

    const parts = (m.parts ?? m.content) as unknown[] | undefined;
    if (!Array.isArray(parts)) return m;

    const strippedParts = parts.map((part: unknown) => {
      const p = part as Record<string, unknown>;
      if (p.type !== 'tool-result' && p.type !== 'tool_result') return p;
      const result = p.result ?? p.output;
      if (!result || typeof result !== 'object') return p;
      const stripped = stripHeavyFields(result);
      return {
        ...p,
        result: stripped,
        output: p.output ? stripped : undefined,
      };
    });

    return { ...m, parts: strippedParts };
  });
}
