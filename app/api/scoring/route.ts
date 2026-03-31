import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { fetchIsochrones, buildIsochCacheKey } from '@/lib/isochrones/fetcher';
import type { PoiRow } from '@/lib/isochrones/fetcher';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const scoringPostSchema = z.object({
  ville:      z.string().min(1).max(200).default('Brest'),
  layers:     z.array(z.enum(['proximity', 'isochrone'])).default(['proximity']),
  profile_id: z.string().uuid().nullable().optional().default(null),
});

// ── GET — Panneaux scorés ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ville     = searchParams.get('ville') ?? 'Brest';
    const limit     = parseInt(searchParams.get('limit') ?? '50', 10);
    const minScore  = parseFloat(searchParams.get('min_score') ?? '0');
    const sortBy    = searchParams.get('sort_by') ?? 'score_ooh_final';

    const validSortCols = new Set([
      'score_ooh_final', 'score_ooh_total', 'score_proximite_lycee',
      'score_proximite_cirfa', 'score_transport', 'score_demo',
    ]);
    const col = validSortCols.has(sortBy) ? sortBy : 'score_ooh_final';

    const supabase = createAdminClient();

    let query = supabase
      .from('panneaux_affichage')
      .select([
        'id', 'reference_panneau', 'regie', 'type_panneau', 'lat', 'lng',
        'ville',
        'score_proximite_lycee', 'score_proximite_cirfa', 'score_transport',
        'score_demo', 'score_ooh_total', 'bonus_isochrone', 'score_ooh_final',
        'poi_lycee_distance_min', 'poi_lycee_nom_proche', 'nb_lycees_300m',
        'poi_cirfa_distance_min', 'poi_cirfa_nom_proche',
        'poi_transport_distance_min', 'poi_transport_nom_proche', 'nb_arrets_300m',
        'in_isochrone_lycee', 'isochrone_lycee_minutes',
        'in_isochrone_cirfa', 'isochrone_cirfa_minutes',
        'score_computed_at', 'scoring_results', 'scoring_profile_id',
      ].join(', '))
      .ilike('ville', ville)
      .gte(col, minScore)
      .order(col, { ascending: false })
      .limit(limit);

    const { data, error } = await query;
    if (error) {
      console.error('[api/scoring] GET error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ panneaux: data ?? [], total: data?.length ?? 0, ville });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/scoring] GET ERREUR:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST — Déclencher le calcul ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const session    = await getSessionOrg(req);
    const rawBody    = await req.json();
    const parsed     = scoringPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join(', ') }, { status: 400 });
    }
    const { ville, layers, profile_id: profileId } = parsed.data;

    const supabase = createAdminClient();

    // ── Vérifier que le profil demandé est accessible ──────────────────────
    if (profileId && session && session.role !== 'super_admin') {
      const { data: prof } = await supabase
        .from('scoring_profiles')
        .select('organization_id, is_template')
        .eq('id', profileId)
        .single();

      if (prof && !prof.is_template && prof.organization_id !== session.orgId) {
        console.warn(`[api/scoring] accès refusé au profil ${profileId} pour org ${session.orgId}`);
        return NextResponse.json({ error: "Accès refusé à ce profil de scoring." }, { status: 403 });
      }
    }
    const results: Record<string, unknown> = { ville, layers };

    // ── Couche 1 : Proximité (v2 si profile_id fourni, v1 sinon) ─────────────
    if (layers.includes('proximity')) {
      const rpcName = profileId ? 'compute_panneau_scores_v2' : 'compute_panneau_scores';
      const rpcArgs = profileId
        ? { p_ville: ville, p_profile_id: profileId }
        : { p_ville: ville };
      const { data, error } = await supabase.rpc(rpcName, rpcArgs);
      if (error) {
        console.error(`[api/scoring] ${rpcName} error:`, error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      results.panneaux_scored_proximity = data;
      results.scoring_function = rpcName;
      console.log(`[api/scoring] Proximité (${rpcName}): ${data} panneaux mis à jour`);
    }

    // ── Couche 2 : Isochrones ─────────────────────────────────────────────────
    if (layers.includes('isochrone')) {
      // 1. Récupérer les lycées et le CIRFA
      const { data: lycees } = await supabase
        .from('poi_france')
        .select('id, nom, lat, lng')
        .eq('categorie', 'lycee')
        .ilike('ville', `%${ville}%`)
        .not('lat', 'is', null)
        .not('lng', 'is', null);

      const { data: cirfas } = await supabase
        .from('poi_france')
        .select('id, nom, lat, lng')
        .eq('categorie', 'cirfa')
        .ilike('ville', `%${ville}%`)
        .not('lat', 'is', null)
        .not('lng', 'is', null);

      const toPoiRow = (p: { id: string; nom: string; lat: number; lng: number }): PoiRow => ({
        id: p.id,
        nom: p.nom,
        lat: p.lat,
        lng: p.lng,
        categorie: 'lycee',
        ville,
      });

      const lyceePois = (lycees ?? []).map(toPoiRow);
      const cirfaPois = (cirfas ?? []).map(toPoiRow);

      const villeKey = ville.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');

      // 2. Générer/récupérer les isochrones (utilise le cache existant)
      const isoJobs = [
        // Lycées : paliers 5 et 10 min piéton
        ...[5, 10].map(min => ({
          pois: lyceePois,
          min,
          categorie: 'lycee',
          cacheKey: buildIsochCacheKey(villeKey, 'lycee', min, 'walk'),
        })),
        // CIRFA : paliers 5, 10, 15 min piéton
        ...[5, 10, 15].map(min => ({
          pois: cirfaPois,
          min,
          categorie: 'cirfa',
          cacheKey: buildIsochCacheKey(villeKey, 'cirfa', min, 'walk'),
        })),
      ];

      let isoGenerated = 0;
      for (const job of isoJobs) {
        if (!job.pois.length) continue;
        const result = await fetchIsochrones(
          job.pois,
          job.min,
          'walk',
          { cacheKey: job.cacheKey, ville, categorie: job.categorie },
          300
        );
        if (result) isoGenerated++;
      }
      results.isochrones_generated = isoGenerated;

      // 3. Appliquer le scoring isochrone
      const { data: isoData, error: isoErr } = await supabase.rpc(
        'compute_isochrone_score',
        { p_ville: ville }
      );
      if (isoErr) {
        console.error('[api/scoring] compute_isochrone_score error:', isoErr.message);
        return NextResponse.json({ error: isoErr.message }, { status: 500 });
      }
      results.panneaux_scored_isochrone = isoData;
      console.log(`[api/scoring] Isochrone: ${isoData} panneaux mis à jour`);
    }

    results.duration_ms = Date.now() - t0;
    return NextResponse.json(results);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/scoring] POST ERREUR:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
