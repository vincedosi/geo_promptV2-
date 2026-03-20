import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET — list available carreaux sources
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('data_sources')
      .select('id, name, geo_config')
      .eq('type', 'carreaux')
      .eq('status', 'active')
      .order('import_date', { ascending: false });

    if (error) throw error;

    const sources = (data ?? []).map(r => ({
      tableName: 'carreaux_filosofi',
      name: r.name,
      id: r.id,
      resolution: r.geo_config?.resolution,
      millesime: r.geo_config?.millesime,
    }));
    return NextResponse.json({ sources });
  } catch (err: unknown) {
    console.error('[api/carreaux GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ sources: [] });
  }
}

// POST — fetch carreaux GeoJSON within a bounding box
export async function POST(req: NextRequest) {
  const { tableName, bbox, millesime, resolution } = await req.json();

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

  try {
    const supabase = createAdminClient();
    const milFilter = millesime   ? String(millesime)   : null;
    const resFilter = resolution  ? String(resolution)  : null;

    const { data, error } = await supabase.rpc('get_carreaux', {
      p_table:      tableName,
      p_west:       west,
      p_south:      south,
      p_east:       east,
      p_north:      north,
      p_millesime:  milFilter,
      p_resolution: resFilter,
    });

    if (error) {
      console.error('[api/carreaux POST] rpc error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[api/carreaux POST] rows returned:', data?.length ?? 0);

    const features = (data ?? []).map((r: { geometry: any; metadata: Record<string, unknown> }) => {
      // Normalize metadata keys to lowercase
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

    return NextResponse.json({ type: 'FeatureCollection', features });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[api/carreaux POST] ERREUR:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
