/**
 * GENESIS — lib/geo/geometry.ts
 *
 * Utilitaires de parsing géométrique pour les données Supabase/PostGIS.
 * Gère les deux formats possibles : GeoJSON objet natif et string WKT/EWKT.
 */

/**
 * Parse le champ metadata retourné par Supabase.
 * PostgREST retourne JSONB en tant qu'objet JS natif dans la plupart des cas,
 * mais certaines fonctions RPC le retournent en tant que string JSON.
 */
export function parseMeta(rawMeta: unknown): Record<string, unknown> {
  if (!rawMeta) return {};
  if (typeof rawMeta === 'string') {
    try { return JSON.parse(rawMeta) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
    return rawMeta as Record<string, unknown>;
  }
  return {};
}

/**
 * Parse une géométrie retournée par Supabase/PostgREST.
 * PostgREST retourne les colonnes geometry PostGIS en GeoJSON objet nativement.
 * Si une string EWKT est retournée (cas dégradé), on la parse.
 */
export function parseGeomFromSupabase(rawGeom: unknown): GeoJSON.Geometry | null {
  if (!rawGeom) return null;

  // Cas 1 : GeoJSON objet natif (comportement standard PostgREST + Supabase)
  if (typeof rawGeom === 'object' && !Array.isArray(rawGeom)) {
    const g = rawGeom as Record<string, unknown>;
    if (g.type && g.coordinates) {
      return { type: g.type, coordinates: g.coordinates } as GeoJSON.Geometry;
    }
  }

  // Cas 2 : String EWKT "SRID=4326;POLYGON((lng lat, ...))" ou WKT "POLYGON(...)"
  if (typeof rawGeom === 'string') {
    try {
      const wkt = rawGeom.replace(/^SRID=\d+;/i, '').trim();
      const parsed = parseWKT(wkt);
      if (parsed) {
        console.warn('[geo/geometry] geom retourné en string EWKT — parsing WKT (PostgREST non-GeoJSON)');
        return parsed;
      }
    } catch {
      // ignore
    }
    console.error('[geo/geometry] geom string non parseable:', (rawGeom as string).substring(0, 80));
    return null;
  }

  console.error('[geo/geometry] geom format inconnu:', typeof rawGeom);
  return null;
}

/**
 * Parse WKT minimal pour POLYGON et MULTIPOLYGON (format INSEE carreaux).
 * Supporte uniquement la géométrie 2D (x y), pas de Z ni M.
 */
export function parseWKT(wkt: string): GeoJSON.Geometry | null {
  const upper = wkt.toUpperCase().trim();

  if (upper.startsWith('POLYGON')) {
    const coords = parseWKTRings(wkt.replace(/^POLYGON\s*/i, ''));
    if (!coords) return null;
    return { type: 'Polygon', coordinates: coords };
  }

  if (upper.startsWith('MULTIPOLYGON')) {
    const inner = wkt.replace(/^MULTIPOLYGON\s*\(/i, '').replace(/\)$/, '').trim();
    const polyStrings = inner.split(/\)\s*,\s*\(/);
    const polygons: number[][][][] = [];
    for (const p of polyStrings) {
      const cleaned = p.replace(/^\(+/, '(').replace(/\)+$/, ')');
      const rings = parseWKTRings(cleaned);
      if (rings) polygons.push(rings);
    }
    if (polygons.length === 0) return null;
    return { type: 'MultiPolygon', coordinates: polygons };
  }

  return null;
}

export function parseWKTRings(s: string): number[][][] | null {
  const stripped = s.trim().replace(/^\(/, '').replace(/\)$/, '');
  const ringStrings = stripped.split(/\)\s*,\s*\(/);
  const rings: number[][][] = [];
  for (const ringStr of ringStrings) {
    const coords = ringStr.trim().replace(/[()]/g, '').split(',').map(pair => {
      const parts = pair.trim().split(/\s+/);
      return [parseFloat(parts[0]), parseFloat(parts[1])];
    }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
    if (coords.length >= 3) rings.push(coords);
  }
  return rings.length > 0 ? rings : null;
}
