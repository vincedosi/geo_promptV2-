/**
 * GENESIS — API Route — /api/carreaux
 * GET  : liste les sources carreaux disponibles (depuis data_sources)
 * POST : retourne le GeoJSON FeatureCollection d'une table carreaux
 * PUT  : enregistre une table carreaux existante dans data_sources (repair/register)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse le champ metadata retourné par Supabase.
 * PostgREST retourne JSONB en tant qu'objet JS natif dans la plupart des cas,
 * mais certaines fonctions RPC le retournent en tant que string JSON.
 * On gère les deux cas pour éviter que le spread `...meta` parte en vrille.
 */
function parseMeta(rawMeta: unknown): Record<string, unknown> {
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
 * Si jamais une string EWKT est retournée (cas dégradé), on la parse.
 */
function parseGeomFromSupabase(rawGeom: unknown): GeoJSON.Geometry | null {
  if (!rawGeom) return null;

  // Cas 1: GeoJSON objet natif (comportement standard PostgREST + Supabase)
  if (typeof rawGeom === 'object' && !Array.isArray(rawGeom)) {
    const g = rawGeom as Record<string, unknown>;
    if (g.type && g.coordinates) {
      return { type: g.type, coordinates: g.coordinates } as GeoJSON.Geometry;
    }
  }

  // Cas 2: String EWKT "SRID=4326;POLYGON((lng lat, ...))" ou WKT "POLYGON(...)"
  if (typeof rawGeom === 'string') {
    try {
      const wkt = rawGeom.replace(/^SRID=\d+;/i, '').trim();
      const parsed = parseWKT(wkt);
      if (parsed) {
        console.warn('[carreaux] geom retourné en string EWKT — parsing WKT (PostgREST non-GeoJSON)');
        return parsed;
      }
    } catch {
      // ignore
    }
    console.error('[carreaux] geom string non parseable:', (rawGeom as string).substring(0, 80));
    return null;
  }

  console.error('[carreaux] geom format inconnu:', typeof rawGeom);
  return null;
}

/**
 * Parse WKT minimal pour POLYGON et MULTIPOLYGON (format INSEE carreaux).
 * Supporte uniquement la géométrie 2D (x y), pas de Z ni M.
 */
function parseWKT(wkt: string): GeoJSON.Geometry | null {
  const upper = wkt.toUpperCase().trim();

  if (upper.startsWith('POLYGON')) {
    const coords = parseWKTRings(wkt.replace(/^POLYGON\s*/i, ''));
    if (!coords) return null;
    return { type: 'Polygon', coordinates: coords };
  }

  if (upper.startsWith('MULTIPOLYGON')) {
    const inner = wkt.replace(/^MULTIPOLYGON\s*\(/i, '').replace(/\)$/, '').trim();
    // Split par ")), ((" pour les polygones du multipolygon
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

function parseWKTRings(s: string): number[][][] | null {
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

// ─── GET : lister les sources carreaux ────────────────────────────────────────
// ?table=nom_table  → compte le nombre EXACT de lignes depuis la vraie table
//                     (pas depuis data_sources qui peut être désynchronisé)

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    // ── Mode stats : comptage réel depuis la table ──
    const url = new URL(request.url);
    const statTable = url.searchParams.get('table');
    if (statTable) {
      if (!/^[a-z0-9_]+$/.test(statTable)) {
        return NextResponse.json({ error: 'Nom de table invalide' }, { status: 400 });
      }
      const t0 = Date.now();
      const { count, error } = await supabase
        .from(statTable)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.error(`[carreaux] stats error for ${statTable}:`, error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      console.log(`[carreaux] stats ${statTable}: ${count} lignes en ${Date.now() - t0}ms`);
      return NextResponse.json({ tableName: statTable, realCount: count ?? 0, queryMs: Date.now() - t0 });
    }

    // ── Mode liste : toutes les sources actives ──
    const { data, error } = await supabase
      .from('data_sources')
      .select('id, name, type, valid_count, geo_config')
      .eq('type', 'carreaux')
      .eq('status', 'active');

    if (error) {
      console.error('[carreaux] list error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sources = (data || []).map(s => ({
      id: s.id,
      name: s.name,
      tableName: (s.geo_config as Record<string, unknown>)?.table_name as string || '',
      count: s.valid_count ?? 0,
    })).filter(s => s.tableName);

    console.log(`[carreaux] GET: ${sources.length} sources actives`);
    return NextResponse.json({ success: true, sources });
  } catch (err) {
    console.error('[carreaux] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST : récupérer le GeoJSON d'une table carreaux ────────────────────────
// Accepte un bbox optionnel [west, south, east, north] pour le chargement par viewport.
// Avec bbox : utilise la fonction RPC get_carreaux_bbox (index GIST, rapide).
// Sans bbox : fallback paginé séquentiel (lent, pour debug uniquement).

const BATCH_SIZE = 1000;    // Supabase PostgREST max rows per request (hard cap)
const DEFAULT_LIMIT = 10000;
const BBOX_LIMIT    = 8000;  // Carreaux max par viewport (paginé côté serveur)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tableName, limit: rawLimit, bbox } = body;

    // Validation stricte du nom de table (uniquement alphanumériques + underscore)
    if (!tableName || typeof tableName !== 'string' || !/^[a-z0-9_]+$/.test(tableName)) {
      return NextResponse.json({ error: 'Nom de table invalide' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // ── Chemin rapide : requête spatiale par bbox ──
    if (bbox && Array.isArray(bbox) && bbox.length === 4) {
      const [west, south, east, north] = bbox.map(Number);

      // Validation bbox
      if ([west, south, east, north].some(isNaN)) {
        return NextResponse.json({ error: 'bbox invalide (4 nombres attendus)' }, { status: 400 });
      }

      const maxRows = typeof rawLimit === 'number' && rawLimit > 0
        ? Math.min(rawLimit, BBOX_LIMIT)
        : BBOX_LIMIT;

      console.log(`[carreaux] ${tableName}: bbox query [${west.toFixed(3)},${south.toFixed(3)},${east.toFixed(3)},${north.toFixed(3)}] limit=${maxRows}`);
      const t0 = Date.now();

      // ── Pagination par boucle : PostgREST hard-cap à 1000 lignes/appel ──
      const allBboxRows: Record<string, unknown>[] = [];
      let bboxFrom = 0;
      let rpcError: { message: string } | null = null;
      let rpcMissingFlag = false;

      while (allBboxRows.length < maxRows) {
        const batchTo = Math.min(bboxFrom + BATCH_SIZE - 1, maxRows - 1);
        const { data: batchData, error: batchError } = await supabase.rpc('get_carreaux_bbox', {
          p_table: tableName,
          p_west: west,
          p_south: south,
          p_east: east,
          p_north: north,
          p_limit: maxRows,
        }).range(bboxFrom, batchTo);

        if (batchError) {
          rpcError = batchError;
          if (batchError.message.includes('function') || batchError.message.includes('does not exist') || batchError.message.includes('42883')) {
            rpcMissingFlag = true;
          }
          break;
        }
        if (!batchData || batchData.length === 0) break;
        allBboxRows.push(...(batchData as Record<string, unknown>[]));
        bboxFrom += batchData.length;
        if (batchData.length < BATCH_SIZE) break; // dernière page
      }

      if (rpcMissingFlag) {
        console.error('[carreaux] ⚠ get_carreaux_bbox introuvable — créez la fonction SQL dans Supabase');
        return NextResponse.json({
          type: 'FeatureCollection',
          features: [],
          _meta: {
            tableName,
            count: 0,
            truncated: false,
            rpcMissing: true,
            // La fonction SQL complète (avec validations de sécurité) est dans sql/002_get_carreaux_bbox.sql
            sqlFile: 'sql/002_get_carreaux_bbox.sql',
            message: 'Exécutez le contenu de sql/002_get_carreaux_bbox.sql dans le Supabase SQL Editor.',
          },
        });
      }

      if (rpcError) {
        console.error('[carreaux] RPC error:', rpcError.message);
        return NextResponse.json({ error: rpcError.message }, { status: 500 });
      }

      const elapsed = Date.now() - t0;
      let nullGeomCount = 0;
      const features: GeoJSON.Feature[] = [];

      for (const row of allBboxRows) {
        const geom = parseGeomFromSupabase(row.geom);
        if (!geom) { nullGeomCount++; continue; }
        const meta = parseMeta(row.metadata);
        features.push({
          type: 'Feature',
          geometry: geom,
          properties: { idcar: row.idcar as string, ...meta },
        });
      }

      console.log(`[carreaux] ${tableName}: ${features.length} features via bbox (${allBboxRows.length} brutes, ${allBboxRows.length / BATCH_SIZE} pages) in ${elapsed}ms`);

      return NextResponse.json({
        type: 'FeatureCollection',
        features,
        _meta: {
          tableName,
          count: features.length,
          rawCount: allBboxRows.length,
          nullGeomCount,
          limit: maxRows,
          truncated: allBboxRows.length >= maxRows,
          bbox: [west, south, east, north],
          queryMs: elapsed,
        },
      });
    }

    // ── Chemin classique : fetch paginé sans filtrage spatial ──
    const maxRows = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT;

    // Vérifier que la table existe dans data_sources (sécurité)
    const { data: srcCheck } = await supabase
      .from('data_sources')
      .select('id')
      .eq('type', 'carreaux')
      .eq('status', 'active')
      .contains('geo_config', { table_name: tableName })
      .limit(1)
      .maybeSingle();

    if (!srcCheck) {
      return NextResponse.json({ error: 'Source carreaux introuvable' }, { status: 404 });
    }

    const allRows: Record<string, unknown>[] = [];
    let from = 0;
    let nullGeomCount = 0;

    console.log(`[carreaux] ${tableName}: fetching up to ${maxRows} rows (batch=${BATCH_SIZE}) — no bbox`);

    while (allRows.length < maxRows) {
      const batchEnd = Math.min(from + BATCH_SIZE - 1, from + (maxRows - allRows.length) - 1);
      const { data, error } = await supabase
        .from(tableName)
        .select('idcar, geom, metadata')
        .range(from, batchEnd);

      if (error) {
        console.error('[carreaux] fetch error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!data || data.length === 0) break;
      allRows.push(...data);
      from += data.length;
      if (data.length < BATCH_SIZE) break;
    }

    console.log(`[carreaux] ${tableName}: ${allRows.length} lignes brutes récupérées (limit=${maxRows})`);

    // Convertir en GeoJSON FeatureCollection
    const features: GeoJSON.Feature[] = [];
    for (const row of allRows) {
      const geom = parseGeomFromSupabase(row.geom);
      if (!geom) {
        nullGeomCount++;
        continue;
      }

      const meta = parseMeta(row.metadata);
      features.push({
        type: 'Feature',
        geometry: geom,
        properties: {
          idcar: row.idcar,
          ...meta,
        },
      });
    }

    if (nullGeomCount > 0) {
      console.warn(`[carreaux] ${tableName}: ${nullGeomCount} lignes ignorées (geom null ou non-parseable)`);
    }

    console.log(`[carreaux] ${tableName}: ${features.length} features GeoJSON retournées`);

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      _meta: {
        tableName,
        count: features.length,
        rawCount: allRows.length,
        nullGeomCount,
        limit: maxRows,
        truncated: allRows.length >= maxRows,
      },
    });
  } catch (err) {
    console.error('[carreaux] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── PUT : enregistrer/réparer une table carreaux dans data_sources ────────────
// Utilisé quand la table existe en base mais pas dans data_sources
// (cas : import fait en CLI Python direct, ou dry-run accidentel)

export async function PUT(request: NextRequest) {
  try {
    const { tableName, sourceName } = await request.json();

    // Validation
    if (!tableName || typeof tableName !== 'string' || !/^[a-z0-9_]+$/.test(tableName)) {
      return NextResponse.json({ error: 'Nom de table invalide' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Vérifier que la table existe (en essayant de lire une ligne)
    const { error: tableError } = await supabase
      .from(tableName)
      .select('idcar')
      .limit(1)
      .maybeSingle();

    if (tableError) {
      console.error('[carreaux] PUT — table check error:', tableError.message);
      return NextResponse.json({
        error: `Table "${tableName}" introuvable ou inaccessible: ${tableError.message}`,
        hint: 'Vérifiez que la table existe dans Supabase et est accessible via service_role.',
      }, { status: 404 });
    }

    // 2. Compter les lignes (approximation via range)
    const { count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });

    const validCount = count ?? 0;

    // 3. Vérifier si une entrée data_sources existe déjà
    const { data: existing } = await supabase
      .from('data_sources')
      .select('id, status')
      .eq('type', 'carreaux')
      .contains('geo_config', { table_name: tableName })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Mettre à jour le statut si nécessaire
      if (existing.status !== 'active') {
        await supabase
          .from('data_sources')
          .update({ status: 'active', valid_count: validCount })
          .eq('id', existing.id);
        console.log(`[carreaux] PUT — source "${tableName}" réactivée (id: ${existing.id})`);
        return NextResponse.json({
          success: true,
          action: 'reactivated',
          id: existing.id,
          tableName,
          count: validCount,
        });
      }
      console.log(`[carreaux] PUT — source "${tableName}" déjà active (id: ${existing.id})`);
      return NextResponse.json({
        success: true,
        action: 'already_registered',
        id: existing.id,
        tableName,
        count: validCount,
      });
    }

    // 4. Créer l'entrée data_sources
    const name = sourceName || tableName.replace(/_/g, ' ');
    const { data: newSrc, error: insertError } = await supabase
      .from('data_sources')
      .insert({
        name,
        type: 'carreaux',
        category: 'carreaux',
        organization_id: '00000000-0000-0000-0000-000000000001',
        original_filename: `${tableName}.table`,
        file_format: 'supabase_table',
        row_count: validCount,
        valid_count: validCount,
        error_count: 0,
        mapping: {},
        geo_config: { table_name: tableName },
        status: 'active',
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[carreaux] PUT — insert error:', insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log(`[carreaux] PUT — source "${tableName}" enregistrée (id: ${newSrc.id}, count: ${validCount})`);
    return NextResponse.json({
      success: true,
      action: 'registered',
      id: newSrc.id,
      tableName,
      count: validCount,
    });
  } catch (err) {
    console.error('[carreaux] PUT error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
