/**
 * /api/debug-coverage
 *
 * Route de debug ULTRA-VERBEUX pour diagnostiquer pourquoi
 * "couverture CIRFA 30 minutes voiture 18-24 ans Bretagne" ne passe pas.
 *
 * Teste chaque étape indépendamment et loggue TOUT.
 * GET ?poi=cirfa&region=Bretagne&minutes=30&demo=ind_18_24
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { resolveCategory } from '@/lib/geo/locations';
import { fetchPois } from '@/lib/geo/fetchPois';
import { ORS_PROFILES } from '@/lib/isochrones/fetcher';

export const maxDuration = 300;

type StepResult = {
  step: string;
  status: 'ok' | 'error' | 'warn';
  duration_ms: number;
  data: unknown;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const poi_input    = searchParams.get('poi')     ?? 'cirfa';
  const region       = searchParams.get('region')  ?? 'Bretagne';
  const minutes      = Number(searchParams.get('minutes') ?? '30');
  const demo_col     = searchParams.get('demo')    ?? 'ind_18_24';
  const mode         = searchParams.get('mode')    ?? 'drive';
  const ors_test_max = Number(searchParams.get('ors_max') ?? '2'); // max ORS calls en test

  const steps: StepResult[] = [];
  const t0 = Date.now();

  function addStep(step: string, status: 'ok' | 'error' | 'warn', data: unknown, tStart: number) {
    steps.push({ step, status, duration_ms: Date.now() - tStart, data });
  }

  const supabase = createAdminClient();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — DB connection + lecture des catégories
  // ══════════════════════════════════════════════════════════════════════════
  let tStep = Date.now();
  let validCats: string[] = [];
  try {
    const { data: catRows, error: catErr } = await supabase
      .from('poi_france')
      .select('categorie')
      .limit(1000);

    if (catErr) {
      addStep('1_categories', 'error', { error: catErr.message, hint: 'Problème connexion Supabase ou table poi_france absente' }, tStep);
    } else {
      validCats = [...new Set((catRows ?? []).map((r: any) => r.categorie as string))].sort();
      const hasCirfa = validCats.some(c => c.toLowerCase().includes('cirfa'));
      addStep('1_categories', hasCirfa ? 'ok' : 'warn', {
        total_categories: validCats.length,
        categories: validCats,
        has_cirfa: hasCirfa,
        cirfa_exact: validCats.filter(c => c.toLowerCase().includes('cirfa')),
        note: hasCirfa ? 'Catégorie cirfa trouvée en base' : '⚠️ AUCUNE catégorie contenant "cirfa" en base !',
      }, tStep);
    }
  } catch (e: any) {
    addStep('1_categories', 'error', { error: e.message }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — resolveCategory
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  const resolvedCategory = resolveCategory(poi_input, validCats);
  addStep('2_resolve_category', resolvedCategory ? 'ok' : 'error', {
    requested: poi_input,
    resolved: resolvedCategory,
    valid_categories: validCats,
    note: resolvedCategory
      ? `OK → catégorie résolue en "${resolvedCategory}"`
      : `⛔ PROBLÈME : "${poi_input}" ne correspond à aucune catégorie valide en base. L'API retournera 0 POIs même si les CIRFA existent !`,
  }, tStep);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Fetch POIs (region=Bretagne, cat=cirfa)
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  let pois: any[] = [];
  try {
    const { pois: fetchedPois, error: poisErr } = await fetchPois(
      supabase,
      resolvedCategory,
      poi_input,
      { region, limit: 5000 }
    );

    if (poisErr) {
      addStep('3_fetch_pois', 'error', {
        error: poisErr,
        region,
        resolved_category: resolvedCategory,
        note: 'Erreur lors du fetch Supabase',
      }, tStep);
    } else {
      pois = fetchedPois;
      const sample = pois.slice(0, 5).map(p => ({ nom: p.nom, lat: p.lat, lng: p.lng, ville: p.ville }));
      addStep('3_fetch_pois', pois.length > 0 ? 'ok' : 'error', {
        count: pois.length,
        region,
        resolved_category: resolvedCategory,
        sample_pois: sample,
        note: pois.length === 0
          ? `⛔ PROBLÈME : 0 POIs trouvés pour "${resolvedCategory}" dans la région "${region}". Vérifier la colonne "region" en base.`
          : `${pois.length} POIs trouvés`,
      }, tStep);
    }
  } catch (e: any) {
    addStep('3_fetch_pois', 'error', { error: e.message }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3b — Vérifier le contenu de la colonne "region" en base
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  try {
    const { data: regionSample, error: regionErr } = await supabase
      .from('poi_france')
      .select('region, categorie')
      .eq('categorie', resolvedCategory ?? poi_input)
      .limit(20);

    if (regionErr) {
      addStep('3b_region_values', 'error', { error: regionErr.message }, tStep);
    } else {
      const uniqueRegions = [...new Set((regionSample ?? []).map((r: any) => r.region))];
      const bretagneMatch = uniqueRegions.filter(r => r && String(r).toLowerCase().includes('bretagne'));
      addStep('3b_region_values', 'ok', {
        category_used: resolvedCategory ?? poi_input,
        sample_rows: regionSample?.slice(0, 10),
        unique_regions_in_sample: uniqueRegions,
        bretagne_variants_found: bretagneMatch,
        note: bretagneMatch.length > 0
          ? `La colonne region contient: ${bretagneMatch.join(', ')}`
          : `⚠️ Aucune valeur "bretagne" trouvée dans les 20 premières lignes. Vérifier le contenu exact de la colonne region.`,
      }, tStep);
    }
  } catch (e: any) {
    addStep('3b_region_values', 'error', { error: e.message }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — Test ORS (1 POI max pour vérifier la clé API)
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    addStep('4_ors_api_key', 'error', {
      note: '⛔ ORS_API_KEY non configurée dans les variables d\'environnement !',
    }, tStep);
  } else {
    addStep('4_ors_api_key', 'ok', {
      key_prefix: apiKey.substring(0, 8) + '...',
      note: 'Clé présente',
    }, tStep);

    if (pois.length > 0) {
      // Test avec le premier POI
      const testPois = pois.slice(0, Math.min(ors_test_max, pois.length));
      tStep = Date.now();
      const profile = ORS_PROFILES[mode] ?? 'driving-car';
      const locations = testPois.map((p: any) => [p.lng, p.lat]);
      const rangeSec = minutes * 60;

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        const orsRes = await fetch(
          `https://api.openrouteservice.org/v2/isochrones/${profile}`,
          {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'Authorization': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json, application/geo+json',
            },
            body: JSON.stringify({ locations, range: [rangeSec], range_type: 'time' }),
          }
        ).finally(() => clearTimeout(timer));

        const rateLimitRemaining = orsRes.headers.get('x-ratelimit-remaining');
        const rateLimitReset     = orsRes.headers.get('x-ratelimit-reset');

        if (!orsRes.ok) {
          const errText = await orsRes.text();
          addStep('4b_ors_test', 'error', {
            http_status: orsRes.status,
            error: errText.slice(0, 500),
            test_pois: testPois.map((p: any) => ({ nom: p.nom, lat: p.lat, lng: p.lng })),
            profile,
            rangeSec,
            ratelimit_remaining: rateLimitRemaining,
            note: orsRes.status === 403 ? '⛔ 403 Forbidden : ORS_API_KEY invalide ou expirée'
                : orsRes.status === 429 ? '⛔ 429 Rate Limit : trop d\'appels ORS'
                : orsRes.status === 400 ? '⛔ 400 Bad Request : coordonnées invalides ou POI hors réseau routier'
                : `HTTP ${orsRes.status}`,
          }, tStep);
        } else {
          const orsData = await orsRes.json();
          const feats = orsData.features ?? [];
          addStep('4b_ors_test', feats.length > 0 ? 'ok' : 'warn', {
            http_status: 200,
            nb_features: feats.length,
            nb_locations_sent: locations.length,
            profile,
            rangeSec,
            ratelimit_remaining: rateLimitRemaining,
            ratelimit_reset: rateLimitReset,
            test_pois: testPois.map((p: any) => ({ nom: p.nom, lat: p.lat, lng: p.lng })),
            note: feats.length === 0
              ? '⚠️ ORS a répondu 200 mais 0 features ! Coordonnées hors réseau routier ?'
              : `ORS OK : ${feats.length} isochrone(s) pour ${locations.length} POI(s)`,
          }, tStep);
        }
      } catch (e: any) {
        addStep('4b_ors_test', 'error', {
          error: e.name === 'AbortError' ? 'Timeout 15s' : e.message,
          test_pois: testPois.map((p: any) => ({ nom: p.nom, lat: p.lat, lng: p.lng })),
          note: e.name === 'AbortError' ? '⛔ ORS ne répond pas en 15s' : `Exception: ${e.message}`,
        }, tStep);
      }
    } else {
      addStep('4b_ors_test', 'warn', {
        note: 'Skipped : 0 POIs trouvés à l\'étape 3, impossible de tester ORS',
      }, tStep);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 — Vérifier data_sources (millesime)
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  try {
    const { data: sources, error: srcErr } = await supabase
      .from('data_sources')
      .select('geo_config, type, name')
      .eq('type', 'carreaux')
      .limit(5);

    if (srcErr) {
      addStep('5_data_sources', 'error', { error: srcErr.message }, tStep);
    } else {
      const millesime = (sources?.[0]?.geo_config as any)?.millesime ?? '2021';
      addStep('5_data_sources', sources?.length ? 'ok' : 'warn', {
        sources: sources?.map((s: any) => ({ type: s.type, name: s.name, geo_config: s.geo_config })),
        millesime_used: millesime,
        note: sources?.length ? 'data_sources OK' : '⚠️ Aucune source "carreaux" en base',
      }, tStep);
    }
  } catch (e: any) {
    addStep('5_data_sources', 'error', { error: e.message }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 — Vérifier que la RPC calculate_network_coverage_v3 existe
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  try {
    // Appel avec des features vides pour tester l'existence de la fonction
    const { data: rpcData, error: rpcErr } = await supabase.rpc('calculate_network_coverage_v3', {
      isochrone_features: [],
      target_column: demo_col,
      p_millesime: '2021',
    });

    if (rpcErr) {
      const isMissing = rpcErr.message?.includes('calculate_network_coverage_v3') || rpcErr.message?.includes('does not exist');
      addStep('6_rpc_exists', 'error', {
        error: rpcErr.message,
        code: rpcErr.code,
        note: isMissing
          ? '⛔ FONCTION POSTGIS MANQUANTE : calculate_network_coverage_v3 absente en base !'
          : `Erreur RPC (mais fonction probablement présente) : ${rpcErr.message}`,
      }, tStep);
    } else {
      addStep('6_rpc_exists', 'ok', {
        response: rpcData,
        note: 'Fonction calculate_network_coverage_v3 présente (appel avec 0 features = résultat 0)',
      }, tStep);
    }
  } catch (e: any) {
    addStep('6_rpc_exists', 'error', { error: e.message }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7 — Simulation calcul complet (estimate temps)
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  const nb_pois     = pois.length;
  const sliced      = Math.min(nb_pois, 300);
  const ors_batch   = 5;
  const ors_timeout = 8;  // seconds
  const ors_retries = 2;
  const nb_batches  = Math.ceil(sliced / ors_batch);
  const worst_case_s = nb_batches * ors_timeout * ors_retries;
  const best_case_s  = nb_batches * 2; // ~2s par batch en conditions normales
  const chat_timeout = 120; // maxDuration du chat route

  addStep('7_time_estimate', worst_case_s > chat_timeout ? 'warn' : 'ok', {
    nb_pois_total: nb_pois,
    nb_pois_used: sliced,
    nb_batches,
    ors_batch_size: ors_batch,
    ors_timeout_per_batch_s: ors_timeout,
    ors_max_retries: ors_retries,
    estimated_best_case_s: best_case_s,
    estimated_worst_case_s: worst_case_s,
    chat_route_maxDuration_s: chat_timeout,
    network_coverage_maxDuration_s: 300,
    warning: worst_case_s > chat_timeout
      ? `⚠️ TIMEOUT PROBABLE : cas pire ${worst_case_s}s > chat route maxDuration=${chat_timeout}s. MAIS le chat délègue à /api/network-coverage (300s). Le problème peut venir là si Vercel coupe après 120s.`
      : `Timing OK : pire cas ${worst_case_s}s < ${chat_timeout}s`,
    tip: 'Le chat route a maxDuration=120s mais délègue à /api/network-coverage (maxDuration=300s). Si le provider héberge Vercel, vérifier que la route network-coverage a bien 300s de timeout.',
  }, tStep);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 8 — Vérifier colonne demo_col dans carreaux_filosofi (millesime 2021)
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  try {
    // Récupérer les millesimes disponibles
    const { data: millesimes, error: milErr } = await supabase
      .from('carreaux_filosofi')
      .select('millesime')
      .limit(10000);

    const uniqueMillesimes = [...new Set((millesimes ?? []).map((r: any) => r.millesime))].sort();

    // Fetch un row spécifiquement millesime=2021 (celui qu'utilise la RPC)
    const { data: row2021 } = await supabase
      .from('carreaux_filosofi')
      .select('millesime, metadata')
      .eq('millesime', '2021')
      .limit(1);

    // Fetch aussi un row du millesime le plus récent disponible
    const latestMillesime = uniqueMillesimes[uniqueMillesimes.length - 1];
    const { data: rowLatest } = await supabase
      .from('carreaux_filosofi')
      .select('millesime, metadata')
      .eq('millesime', latestMillesime)
      .limit(1);

    if (milErr) {
      addStep('8_carreaux_check', 'error', {
        error: milErr.message,
        note: '⛔ Table carreaux_filosofi inaccessible',
      }, tStep);
    } else {
      const meta2021  = row2021?.[0]?.metadata  ?? null;
      const metaLatest = rowLatest?.[0]?.metadata ?? null;

      const keys2021   = meta2021  ? Object.keys(meta2021)  : null;
      const keysLatest = metaLatest ? Object.keys(metaLatest) : null;

      const hasDemoIn2021   = keys2021  ? keys2021.some(k => k.toLowerCase() === demo_col.toLowerCase())   : false;
      const hasDemoInLatest = keysLatest ? keysLatest.some(k => k.toLowerCase() === demo_col.toLowerCase()) : false;

      // Chercher le nom exact (case peut différer: ind_18_24 vs Ind_18_24)
      const exactIn2021   = keys2021?.find(k => k.toLowerCase() === demo_col.toLowerCase());
      const exactInLatest = keysLatest?.find(k => k.toLowerCase() === demo_col.toLowerCase());

      const status = hasDemoIn2021 ? 'ok' : hasDemoInLatest ? 'warn' : 'error';

      addStep('8_carreaux_check', status, {
        millesimes_disponibles: uniqueMillesimes,
        millesime_utilise_par_rpc: '2021',
        millesime_le_plus_recent: latestMillesime,
        '2021_row_found': !!meta2021,
        '2021_metadata_keys': keys2021,
        '2021_has_demo_col': hasDemoIn2021,
        '2021_exact_key': exactIn2021 ?? null,
        latest_metadata_keys: keysLatest,
        latest_has_demo_col: hasDemoInLatest,
        latest_exact_key: exactInLatest ?? null,
        demo_col_requested: demo_col,
        note: !meta2021
          ? `⛔ AUCUN carreaux avec millesime="2021" en base ! La RPC va chercher dans le vide. Millesimes présents: ${uniqueMillesimes.join(', ')}`
          : !hasDemoIn2021
            ? `⛔ PROBLÈME TROUVÉ : "${demo_col}" absent des carreaux 2021 ! PostGIS retournera 0. Clés 2021: [${keys2021?.join(', ')}]. ${hasDemoInLatest ? `La colonne existe dans millesime=${latestMillesime} — corriger data_sources.geo_config.millesime !` : `Colonne "${demo_col}" absente dans tous les millesimes testés.`}`
            : exactIn2021 !== demo_col
              ? `⚠️ Casse différente ! Demandé "${demo_col}", trouvé "${exactIn2021}" dans 2021. La RPC doit utiliser la casse exacte.`
              : `"${demo_col}" présent et correct dans millesime=2021`,
      }, tStep);
    }
  } catch (e: any) {
    addStep('8_carreaux_check', 'error', { error: e.message }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 8b — Test RPC calculate_network_coverage_v3 directement (avec isochrone simple)
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  try {
    // Isochrone rectangulaire simple centrée sur Saint-Brieuc (CIRFA Bretagne)
    const testFeature = {
      type: 'Feature',
      properties: { poi_name: 'Test Saint-Brieuc' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-3.1, 48.3], [-2.4, 48.3], [-2.4, 48.8],
          [-3.1, 48.8], [-3.1, 48.3],
        ]],
      },
    };
    const { data: rpcData, error: rpcErr } = await supabase.rpc('calculate_network_coverage_v3', {
      isochrone_features: [testFeature],
      target_column: demo_col,
      p_millesime: '2021',
    });
    if (rpcErr) {
      addStep('8b_rpc_v3_direct', 'error', {
        error: rpcErr.message,
        note: '⛔ RPC v3 erreur directe',
      }, tStep);
    } else if (rpcData?.error) {
      addStep('8b_rpc_v3_direct', 'error', {
        error: rpcData.error,
        note: `⛔ RPC v3 erreur SQL : ${rpcData.error}`,
      }, tStep);
    } else {
      addStep('8b_rpc_v3_direct', 'ok', {
        coverage: rpcData?.coverage,
        total_pop: rpcData?.total_pop,
        penetration_rate: rpcData?.penetration_rate,
        breakdown: rpcData?.breakdown_by_poi,
        note: `✅ RPC v3 OK — coverage=${rpcData?.coverage} total_pop=${rpcData?.total_pop}`,
      }, tStep);
    }
  } catch (e: any) {
    addStep('8b_rpc_v3_direct', 'error', { error: e.message }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 9 — Test appel /api/network-coverage complet (sans timeout chat)
  // ══════════════════════════════════════════════════════════════════════════
  tStep = Date.now();
  const testFull = searchParams.get('full') === '1';
  if (testFull) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 295_000);
      const res = await fetch(`${baseUrl}/api/network-coverage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          poi_category: poi_input,
          travel_time_minutes: minutes,
          target_demo_column: demo_col,
          target_demo_label: 'Jeunes 18-24 ans',
          mode,
          region,
          force_recalculate: false,
        }),
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const errText = await res.text();
        addStep('9_full_api_call', 'error', {
          http_status: res.status,
          error: errText.slice(0, 1000),
          note: `API /network-coverage a retourné HTTP ${res.status}`,
        }, tStep);
      } else {
        const data = await res.json();
        addStep('9_full_api_call', 'ok', {
          coverage: data.coverage,
          nb_pois: data.nb_pois,
          from_cache: data.from_cache,
          millesime: data.millesime,
          geo_scope: data.geo_scope,
          has_union_geojson: !!data.union_geojson,
          union_geojson_features: data.union_geojson?.features?.length ?? 0,
          note: `Couverture = ${data.coverage} ${demo_col}`,
        }, tStep);
      }
    } catch (e: any) {
      addStep('9_full_api_call', 'error', {
        error: e.name === 'AbortError' ? 'TIMEOUT (>295s)' : e.message,
        note: e.name === 'AbortError'
          ? '⛔ TIMEOUT TOTAL : l\'API network-coverage a pris >295s. Probablement trop de POIs ou ORS lent.'
          : `Exception: ${e.message}`,
      }, tStep);
    }
  } else {
    addStep('9_full_api_call', 'warn', {
      note: 'Skipped — ajouter ?full=1 à l\'URL pour tester l\'appel complet (~1-5 min)',
    }, tStep);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  const errors   = steps.filter(s => s.status === 'error');
  const warnings = steps.filter(s => s.status === 'warn');

  return NextResponse.json({
    test_params: { poi: poi_input, region, minutes, demo_col, mode, ors_test_max },
    total_duration_ms: Date.now() - t0,
    summary: {
      total_steps: steps.length,
      errors: errors.length,
      warnings: warnings.length,
      first_error: errors[0]?.step ?? null,
      verdict: errors.length > 0
        ? `⛔ ${errors.length} ERREUR(S) : vérifier les étapes ${errors.map(e => e.step).join(', ')}`
        : warnings.length > 0
          ? `⚠️ OK avec ${warnings.length} avertissement(s)`
          : '✅ Tous les checks passent',
    },
    steps,
  }, {
    headers: { 'Content-Type': 'application/json' },
  });
}
