/**
 * lib/chat/tools/audienceCoverage.ts
 * Outil calculate_audience_coverage — nombre de personnes d'une cible
 * dans un isochrone ORS autour d'un lieu unique.
 */

import { createAdminClient } from '@/lib/auth';
import { ORS_PROFILES }      from '@/lib/isochrones/fetcher';

export async function audienceCoverage(args: Record<string, unknown>) {
  const location_name       = String(args.location_name       ?? '');
  const travel_time_minutes = Number(args.travel_time_minutes ?? 30);
  const target_column       = String(args.target_column       ?? 'Ind');
  const target_label        = String(args.target_label        ?? 'Population totale');
  const mode                = String(args.mode                ?? 'drive');

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return { error: "ORS_API_KEY non configurée — impossible de calculer l'isochrone." };

  // 1. Géocodage via BAN
  let lat: number, lng: number;
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const banRes = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(location_name)}&limit=1&type=municipality`,
      { signal: ctrl.signal },
    ).finally(() => clearTimeout(timer));

    const banData = await banRes.json();
    const coords  = banData?.features?.[0]?.geometry?.coordinates;
    if (!coords) return { error: `Lieu introuvable : "${location_name}"` };
    [lng, lat] = coords as [number, number];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { error: `Géocodage échoué : ${msg}` };
  }

  // 2. Isochrone ORS
  const profile       = ORS_PROFILES[mode] ?? 'driving-car';
  const orsTimeoutMs  = travel_time_minutes <= 30 ? 15_000 : travel_time_minutes <= 60 ? 25_000 : 35_000;
  let isoFeature: Record<string, unknown> | null = null;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), orsTimeoutMs);
    const orsRes = await fetch(
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
          range:      [travel_time_minutes * 60],
          range_type: 'time',
        }),
      },
    ).finally(() => clearTimeout(timer));

    if (!orsRes.ok) {
      const err = await orsRes.text();
      return { error: `ORS erreur ${orsRes.status}: ${err}` };
    }
    const orsData = await orsRes.json();
    isoFeature    = orsData.features?.[0];
    if (!isoFeature) return { error: "ORS n'a retourné aucun isochrone" };
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    return {
      error: e.name === 'AbortError'
        ? `Timeout ORS (${orsTimeoutMs / 1000}s) — réessayez ou réduisez le temps de trajet`
        : e.message,
    };
  }

  // 3. Croisement carreaux Filosofi
  const supabase = createAdminClient();
  console.log(`[chat/coverage] target_column=${target_column}`);

  const { data: coverage, error: rpcErr } = await supabase.rpc('calculate_target_coverage', {
    isochrone_geojson: JSON.stringify((isoFeature as { geometry: unknown }).geometry),
    target_column,
    target_table:  'carreaux_filosofi',
    p_resolution:  '200m',
    p_millesime:   '2021',
  });

  if (rpcErr) {
    console.error('[chat/coverage] RPC error:', rpcErr.message);
    return { error: rpcErr.message };
  }

  console.log(`[chat/coverage] "${location_name}" ${travel_time_minutes}min ${mode} → ${target_column} = ${coverage}`);

  return {
    location_name,
    travel_time_minutes,
    target_column,
    target_label,
    mode,
    coverage_count:   Number(coverage ?? 0),
    coordonnees:      { lat, lng },
    isochroneGeoJSON: {
      type:       'FeatureCollection',
      features:   [isoFeature],
      _meta:      { mode, minutes: travel_time_minutes },
      _fromCache: false,
      _cachedAt:  null,
    },
  };
}
