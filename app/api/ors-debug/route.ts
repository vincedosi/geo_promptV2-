/**
 * /api/ors-debug — Diagnostic ORS : appel direct + affichage résultat brut
 * Usage : GET /api/ors-debug?lng=-4.4861&lat=48.3904&minutes=60&mode=drive
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lng     = parseFloat(searchParams.get('lng')     ?? '-4.4861');
  const lat     = parseFloat(searchParams.get('lat')     ?? '48.3904');
  const minutes = parseInt  (searchParams.get('minutes') ?? '60', 10);
  const mode    = searchParams.get('mode') ?? 'drive';

  const apiKey = process.env.ORS_API_KEY;

  const diag: Record<string, unknown> = {
    params: { lng, lat, minutes, mode },
    ors_api_key_set:    !!apiKey,
    ors_api_key_prefix: apiKey ? apiKey.slice(0, 8) + '...' : null,
  };

  if (!apiKey) {
    return NextResponse.json({ ...diag, error: 'ORS_API_KEY non définie' }, { status: 500 });
  }

  const profiles: Record<string, string> = {
    drive: 'driving-car',
    walk:  'foot-walking',
    bike:  'cycling-regular',
  };
  const profile = profiles[mode] ?? 'driving-car';
  const rangeSec = minutes * 60;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(
      `https://api.openrouteservice.org/v2/isochrones/${profile}`,
      {
        method:  'POST',
        signal:  ctrl.signal,
        headers: {
          'Authorization': apiKey,
          'Content-Type':  'application/json',
          'Accept':        'application/json, application/geo+json',
        },
        body: JSON.stringify({
          locations:  [[lng, lat]],
          range:      [rangeSec],
          range_type: 'time',
        }),
      }
    );
    clearTimeout(timer);

    diag.ors_status     = res.status;
    diag.ors_status_text = res.statusText;
    diag.ors_headers    = Object.fromEntries(res.headers.entries());

    const body = await res.text();
    diag.ors_response_raw = body.slice(0, 2000); // truncate for display

    if (!res.ok) {
      return NextResponse.json({ ...diag, error: `ORS HTTP ${res.status}` }, { status: 200 });
    }

    let parsed: any;
    try { parsed = JSON.parse(body); } catch { parsed = null; }

    diag.ors_features_count = parsed?.features?.length ?? 0;
    diag.ors_feature_type   = parsed?.features?.[0]?.geometry?.type ?? null;
    diag.ors_bbox           = parsed?.bbox ?? null;
    diag.success            = true;

    return NextResponse.json(diag, { status: 200 });

  } catch (e: any) {
    clearTimeout(timer);
    diag.error     = e.name === 'AbortError' ? 'Timeout (15s)' : e.message;
    diag.error_type = e.name;
    return NextResponse.json(diag, { status: 200 });
  }
}
