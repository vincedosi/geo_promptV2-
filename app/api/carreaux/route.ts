import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

const DATABASE_URL = process.env.SUPABASE_DB_URL ?? '';

function getDb() {
  return postgres(DATABASE_URL, { max: 2, idle_timeout: 20 });
}

// GET — list available carreaux sources
export async function GET() {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT id, name, geo_config
      FROM data_sources
      WHERE type = 'carreaux'
        AND status = 'active'
      ORDER BY import_date DESC
    `;
    const sources = rows.map(r => ({
      tableName: 'carreaux_filosofi',
      name: r.name,
      id: r.id,
      resolution: r.geo_config?.resolution,
      millesime: r.geo_config?.millesime,
    }));
    return NextResponse.json({ sources });
  } catch (err) {
    console.error('[api/carreaux GET]', err);
    return NextResponse.json({ sources: [] });
  } finally {
    await sql.end();
  }
}

// POST — fetch carreaux GeoJSON within a bounding box
export async function POST(req: NextRequest) {
  const { tableName, bbox, millesime } = await req.json();

  // Validate tableName to prevent SQL injection — only allow alphanumeric + underscore
  if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return NextResponse.json({ error: 'Invalid table name' }, { status: 400 });
  }
  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
    return NextResponse.json({ error: 'bbox must be [west, south, east, north]' }, { status: 400 });
  }

  const [west, south, east, north] = bbox.map(Number);
  if ([west, south, east, north].some(isNaN)) {
    return NextResponse.json({ error: 'bbox values must be numbers' }, { status: 400 });
  }

  const sql = getDb();
  try {
    // Use latest millesime by default
    const milFilter = millesime ? String(millesime) : null;

    const rows = await sql.unsafe(`
      SELECT
        ST_AsGeoJSON(geom)::json AS geometry,
        metadata
      FROM ${tableName}
      WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        ${milFilter ? 'AND millesime = $5' : 'AND millesime = (SELECT MAX(millesime) FROM ' + tableName + ')'}
      LIMIT 50000
    `, milFilter ? [west, south, east, north, milFilter] : [west, south, east, north]);

    const features = rows.map(r => {
      // Normalize metadata keys to lowercase for consistent access
      const raw = r.metadata ?? {};
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        props[k.toLowerCase()] = v;
      }
      return {
        type: 'Feature' as const,
        geometry: r.geometry,
        properties: props,
      };
    });

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (err) {
    console.error('[api/carreaux POST]', err);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  } finally {
    await sql.end();
  }
}
