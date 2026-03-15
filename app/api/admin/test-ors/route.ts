/**
 * GET /api/admin/test-ors
 * Test rapide : appel ORS isochrones pour un point fixe (Paris).
 * Retourne le status HTTP, la durée, et un extrait de la réponse.
 */
import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ORS_API_KEY non définie' }, { status: 500 });

  const t0 = Date.now();
  let status = 0;
  let body = '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch('https://api.openrouteservice.org/v2/isochrones/driving-car', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization:  apiKey,
        'Content-Type': 'application/json',
        Accept:         'application/geo+json',
      },
      body: JSON.stringify({
        locations:  [[2.3522, 48.8566]], // Paris
        range:      [3600],              // 60 min
        range_type: 'time',
      }),
    });
    clearTimeout(timer);
    status = res.status;
    body   = await res.text();
  } catch (e: any) {
    return NextResponse.json({
      ok:      false,
      error:   e.name === 'AbortError' ? 'Timeout 30s' : e.message,
      elapsed: Date.now() - t0,
    });
  }

  const elapsed = Date.now() - t0;
  let parsed: any = null;
  try { parsed = JSON.parse(body); } catch { /* */ }

  return NextResponse.json({
    ok:           status === 200,
    status,
    elapsed_ms:   elapsed,
    features:     parsed?.features?.length ?? null,
    error_detail: status !== 200 ? body.slice(0, 400) : undefined,
  });
}
