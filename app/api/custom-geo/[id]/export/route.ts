import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { texteCpDv360, texteSdfDv360 } from '@/lib/digital/fichiers-dv360';
import { buildZoneBiddingScript, buildWeightedZoneBiddingScript } from '@/lib/digital/dv360-bidding-script';
import { toSlug } from '@/lib/custom-geo/slug';
import { checkZoneAccess } from '@/lib/campaigns/access';
import { lireCodesDeZone } from '@/lib/custom-geo/codes-zone';
import { refusZonePays } from '@/lib/zones/couverture';
import { refusActivationServeur } from '@/lib/zones/activation-serveur';

export const dynamic = 'force-dynamic';

/** Les formats qui partent vers une plateforme (DV360, TikTok) : ils activent la zone. */
const FORMATS_DSP = new Set(['dv360_cp', 'dv360_sdf', 'bidding_script', 'tiktok_geo']);

/** Items d'une zone pour les exports pondérés (RPC get_zone_items_export). */
interface ZoneExportItem {
  poi_id: string;
  poi_name: string;
  lat: number;
  lng: number;
  radius_km: number;
  cps: string[];
}

/**
 * Parse ?weights={"<poi_id>":<pct>} (plan média). Renvoie null si absent ou
 * invalide — les formats retombent alors sur leur variante non pondérée.
 */
function parseWeights(searchParams: URLSearchParams): Record<string, number> | null {
  const raw = searchParams.get('weights');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) return null;
      out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
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

  const access = await checkZoneAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  // Get zone name for filename
  const { data: zone } = await supabase
    .from('custom_geo_zones')
    .select('name, recette, org_id')
    .eq('id', id)
    .single();
  // Une zone pays n'a pas de codes : un fichier vide se lirait comme une zone vide (sql/296).
  const refusPays = refusZonePays(zone?.recette);
  if (refusPays) return refusPays;
  // B8 (décision du 02/11, tour 3 N-1/N-2) : un fichier DSP ACTIVE la zone. Un rayon sous le minimum d'activation (le
  // sien ou celui d'une source de combinaison) serait élargi en silence aux codes postaux qu'il touche : refusé, valeur
  // dite. Les exports d'analyse (CSV, GeoJSON) restent servis.
  if (FORMATS_DSP.has(format) && zone) {
    let tropFin: string | null;
    try {
      tropFin = await refusActivationServeur(supabase, zone.org_id, zone.recette);
    } catch (e) {
      console.error('[custom-geo/export] sources de la zone :', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (tropFin) return NextResponse.json({ error: tropFin, refus: 'rayon_non_activable' }, { status: 422 });
  }

  const slug = toSlug(zone?.name ?? id.slice(0, 8));

  // Poids du plan média ({poi_id: pct}) — active les variantes pondérées
  // de bidding_script et tiktok_geo (une entrée par item de la zone).
  const weights = parseWeights(searchParams);
  let exportItems: ZoneExportItem[] | null = null;
  if (weights && (format === 'bidding_script' || format === 'tiktok_geo')) {
    const { data: itemsData, error: itemsErr } = await supabase.rpc('get_zone_items_export', {
      p_zone_id: id,
      p_caller_user_id: profile.id,
    }) as { data: { items: ZoneExportItem[] } | null; error: { message: string } | null };
    if (itemsErr) {
      console.warn('[custom-geo/export] items export', itemsErr.message);
    }
    exportItems = itemsData?.items ?? null;
  }

  if (format === 'bidding_script' && weights && exportItems?.length) {
    const tiers = exportItems.map(it => ({
      name: it.poi_name,
      cps: it.cps,
      score: (weights[it.poi_id] ?? 0) / 100,
    }));
    const script = buildWeightedZoneBiddingScript(zone?.name ?? slug, tiers);
    return new Response(script, {
      headers: {
        'Content-Type': 'text/x-python; charset=utf-8',
        'Content-Disposition': `attachment; filename="zone_${slug}_custom_bidding_pondere.py"`,
      },
    });
  }

  if (format === 'tiktok_geo' && weights && exportItems?.length) {
    const budgetRaw = Number(searchParams.get('budget'));
    const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;
    const sorted = [...exportItems].sort((a, b) => (weights[b.poi_id] ?? 0) - (weights[a.poi_id] ?? 0));
    const fmtEur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

    const lines = [
      `Zone : ${zone?.name ?? id} — plan média pondéré`,
      budget ? `Budget total : ${fmtEur(budget)}` : 'Budget total : à répartir selon les % ci-dessous',
      '',
      'TikTok ne supporte ni le ciblage par code postal en France, ni la pondération',
      'dans un même ad group → créer UN AD GROUP PAR ZONE avec sa part de budget,',
      'ciblage Localisation > Rayon (coller lat, lng puis régler le curseur).',
      '',
      ...sorted.flatMap(it => {
        const pct = weights[it.poi_id] ?? 0;
        return [
          `── ${it.poi_name} — ${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % du budget${budget ? ` (${fmtEur((pct / 100) * budget)})` : ''} ──`,
          `  Rayon : ${it.lat.toFixed(5)}, ${it.lng.toFixed(5)} — ${it.radius_km} km`,
          `  Codes postaux couverts (référence) : ${it.cps.length}`,
          '',
        ];
      }),
      'Rappel : le cercle circonscrit déborde de la zone réelle, et TikTok ne',
      'permet pas d\'exclure des zones — les recouvrements entre rayons sont',
      'arbitrés par les budgets d\'ad groups.',
      '',
    ];

    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="zone_${slug}_tiktok_geo_pondere.txt"`,
      },
    });
  }

  if (format === 'csv_cp' || format === 'csv_iris') {
    const codeType = format === 'csv_cp' ? 'cp' : 'iris';
    const headerName = format === 'csv_cp' ? 'code_postal' : 'code_iris';

    // Lecture paginée : PostgREST coupe une table à 1 000 lignes (`db-max-rows`)
    // et l'ancien `.limit(100000)` ne levait rien (lib/custom-geo/codes-zone.ts).
    let codes: string[];
    try {
      codes = await lireCodesDeZone(supabase, id, codeType);
    } catch (e) {
      console.error('[custom-geo/export] codes', e instanceof Error ? e.message : String(e));
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const csv = [headerName, ...codes].join('\n');
    const ext = 'csv';

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="zone_${slug}_${codeType}.${ext}"`,
      },
    });
  }

  if (format === 'dv360_cp' || format === 'dv360_sdf' || format === 'bidding_script') {
    // Lecture paginée, même raison que l'export CSV ci-dessus.
    let cps: string[];
    try {
      cps = await lireCodesDeZone(supabase, id, 'cp');
    } catch (e) {
      console.error('[custom-geo/export] codes', e instanceof Error ? e.message : String(e));
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    if (format === 'dv360_cp') {
      // Un code postal par ligne : prêt à coller dans le ciblage géo DV360
      // (bulk entry, type « Postal code », pays France). Même texte que le
      // fichier d'une extraction (`lib/digital/fichiers-dv360.ts`, lot 7).
      return new Response(texteCpDv360(cps), {
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
    // « Geography Targeting - Include » d'un SDF Line Items (texte partagé avec
    // le fichier d'une extraction, lot 7).
    return new Response(texteSdfDv360(zone?.name ?? id, cps), {
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
