import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'zone';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') ?? 'csv_cp';

  const supabase = createAdminClient();

  // Get zone name for filename
  const { data: zone } = await supabase
    .from('custom_geo_zones')
    .select('name')
    .eq('id', id)
    .single();

  const slug = toSlug(zone?.name ?? id.slice(0, 8));

  if (format === 'csv_cp' || format === 'csv_iris') {
    const codeType = format === 'csv_cp' ? 'cp' : 'iris';
    const headerName = format === 'csv_cp' ? 'code_postal' : 'code_iris';

    const { data: codes, error } = await supabase
      .from('custom_geo_zone_codes')
      .select('code')
      .eq('zone_id', id)
      .eq('code_type', codeType)
      .order('code');

    if (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const csv = [headerName, ...(codes ?? []).map(r => r.code)].join('\n');
    const ext = 'csv';

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="zone_${slug}_${codeType}.${ext}"`,
      },
    });
  }

  if (format === 'geojson') {
    const { data: feature, error } = await supabase.rpc('get_custom_geo_zone_feature', { p_zone_id: id });

    if (error || !feature) {
      return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
    }

    const fc = { type: 'FeatureCollection', features: [feature] };

    return new Response(JSON.stringify(fc, null, 2), {
      headers: {
        'Content-Type': 'application/geo+json; charset=utf-8',
        'Content-Disposition': `attachment; filename="zone_${slug}.geojson"`,
      },
    });
  }

  return NextResponse.json({ error: 'Invalid format. Use csv_cp, csv_iris, or geojson' }, { status: 400 });
}
