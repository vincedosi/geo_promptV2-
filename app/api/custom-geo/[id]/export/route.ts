import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { mapPostalCodesToGeoIds, GEO_POSTAL_FR_VERSION } from '@/lib/digital/dv360-geo';
import { buildZoneBiddingScript } from '@/lib/digital/dv360-bidding-script';

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
      .order('code')
      .limit(100000); // PostgREST tronque à 5000 rows par défaut (zone France entière : 6 187 CP)

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

  if (format === 'dv360_cp' || format === 'dv360_sdf' || format === 'bidding_script') {
    const { data: codes, error } = await supabase
      .from('custom_geo_zone_codes')
      .select('code')
      .eq('zone_id', id)
      .eq('code_type', 'cp')
      .order('code')
      .limit(100000); // PostgREST tronque à 5000 rows par défaut

    if (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const cps = (codes ?? []).map(r => r.code);

    if (format === 'dv360_cp') {
      // Un code postal par ligne : prêt à coller dans le ciblage géo DV360
      // (bulk entry, type « Postal code », pays France).
      return new Response(cps.join('\n'), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="zone_${slug}_dv360_cp.txt"`,
        },
      });
    }

    if (format === 'bidding_script') {
      // Script custom bidding DV360 (Python restreint) — à coller dans
      // Custom bidding > Scripted. Signal zip_postal_code = CP bruts.
      const script = buildZoneBiddingScript(zone?.name ?? slug, cps);
      return new Response(script, {
        headers: {
          'Content-Type': 'text/x-python; charset=utf-8',
          'Content-Disposition': `attachment; filename="zone_${slug}_custom_bidding.py"`,
        },
      });
    }

    // dv360_sdf : geo IDs Google prêts à coller dans la colonne
    // « Geography Targeting - Include » d'un SDF Line Items.
    const { mapped, unmapped, sdfString } = mapPostalCodesToGeoIds(cps);
    const lines = [
      `Zone : ${zone?.name ?? id}`,
      `Référentiel geotargets Google ${GEO_POSTAL_FR_VERSION} — ${mapped.length} CP mappés sur ${cps.length}`,
      '',
      'Geography Targeting - Include (à coller dans le SDF Line Items) :',
      sdfString || '(aucun geo ID mappé)',
    ];
    if (unmapped.length > 0) {
      lines.push(
        '',
        `Codes postaux sans geo ID Google (${unmapped.length}, à cibler manuellement) :`,
        unmapped.join(', '),
      );
    }

    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="zone_${slug}_dv360_sdf.txt"`,
      },
    });
  }

  if (format === 'tiktok_geo') {
    // TikTok Ads ne supporte pas le ciblage par code postal en France.
    // Ciblage recommandé : mode Rayon (1-50 km, cumulables par ad group) —
    // un cercle circonscrit par poche disjointe de la zone (RPC PostGIS).
    // Fallback grossier : régions + départements couvrant la zone.
    const { data: radiusTargets, error: radiusErr } = await supabase
      .rpc('get_zone_radius_targets', { p_zone_id: id }) as {
        data: { lat: number; lng: number; radius_km: number; area_km2: number }[] | null;
        error: { message: string } | null;
      };
    if (radiusErr) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const { data: geoCodes, error: geoErr } = await supabase
      .from('custom_geo_zone_codes')
      .select('code_type, code')
      .eq('zone_id', id)
      .in('code_type', ['dept', 'region'])
      .order('code')
      .limit(1000);
    if (geoErr) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const deptCodes = (geoCodes ?? []).filter(r => r.code_type === 'dept').map(r => r.code);
    const regionCodes = (geoCodes ?? []).filter(r => r.code_type === 'region').map(r => r.code);

    const [{ data: depts }, { data: regions }] = await Promise.all([
      deptCodes.length > 0
        ? supabase.from('ref_departements').select('code_dept, nom_dept').in('code_dept', deptCodes).order('code_dept')
        : Promise.resolve({ data: [] as { code_dept: string; nom_dept: string }[] }),
      regionCodes.length > 0
        ? supabase.from('ref_regions').select('code_region, nom_region').in('code_region', regionCodes).order('code_region')
        : Promise.resolve({ data: [] as { code_region: string; nom_region: string }[] }),
    ]);

    // Rayons : max 50 entrées (plusieurs rayons cumulables par ad group TikTok),
    // fragments < 1 km² signalés à part — jamais de troncature silencieuse.
    const MAX_RADIUS_TARGETS = 50;
    const allTargets = radiusTargets ?? [];
    const significant = allTargets.filter(t => t.area_km2 >= 1);
    const fragments = allTargets.length - significant.length;
    const kept = significant.slice(0, MAX_RADIUS_TARGETS);
    const dropped = significant.length - kept.length;

    const lines = [
      `Zone : ${zone?.name ?? id}`,
      'Ciblage géo TikTok Ads — France (le ciblage par code postal n\'existe pas en France sur TikTok).',
      '',
      '── OPTION 1 (recommandée) — Ciblage par rayon ──────────────────────',
      'Ad group (Ad Set) > Audience > Localisation > Rayon : coller les coordonnées',
      'lat, lng puis régler le curseur au rayon indiqué. Cumuler les rayons dans',
      'le même ad group. Rappel : TikTok ne permet pas d\'exclure des zones, et',
      'le cercle circonscrit déborde légèrement de la zone réelle.',
      '',
      `Rayons (${kept.length}) :`,
      ...kept.map(t => `  ${t.lat.toFixed(5)}, ${t.lng.toFixed(5)} — rayon ${t.radius_km} km (poche ~${Math.round(t.area_km2)} km²)`),
      ...(fragments > 0 ? ['', `${fragments} fragment(s) < 1 km² ignoré(s) (résidus géométriques).`] : []),
      ...(dropped > 0 ? [`${dropped} poche(s) au-delà de ${MAX_RADIUS_TARGETS} non listée(s) — affiner la zone.`] : []),
      '',
      '── OPTION 2 (fallback grossier) — Localisations administratives ───',
      `Régions (${regions?.length ?? 0}) :`,
      ...(regions ?? []).map(r => `  ${r.nom_region}`),
      '',
      `Départements (${depts?.length ?? 0}) :`,
      ...(depts ?? []).map(d => `  ${d.nom_dept} (${d.code_dept})`),
      '',
    ];

    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="zone_${slug}_tiktok_geo.txt"`,
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

  return NextResponse.json(
    { error: 'Invalid format. Use csv_cp, csv_iris, geojson, dv360_cp, dv360_sdf, bidding_script, or tiktok_geo' },
    { status: 400 },
  );
}
