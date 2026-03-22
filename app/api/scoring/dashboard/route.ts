import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET /api/scoring/dashboard?ville=Brest
export async function GET(req: NextRequest) {
  const ville = req.nextUrl.searchParams.get('ville');
  if (!ville) return NextResponse.json({ error: 'ville requis' }, { status: 400 });

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('panneaux_affichage')
      .select(`
        id, reference_panneau, regie, type_panneau, lat, lng, ville,
        score_ooh_final, score_ooh_total,
        score_proximite_lycee, score_proximite_cirfa, score_transport, score_demo,
        bonus_isochrone, poi_lycee_distance_min, poi_lycee_nom_proche,
        scoring_results, scoring_profile_id, score_computed_at
      `)
      .ilike('ville', ville)
      .not('score_ooh_final', 'is', null)
      .order('score_ooh_final', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: `Aucun panneau scoré pour ${ville}` }, { status: 404 });
    }

    const panneaux = data as Array<{
      id: string; reference_panneau: string | null; regie: string | null;
      type_panneau: string | null; lat: number; lng: number; ville: string;
      score_ooh_final: number | null; score_ooh_total: number | null;
      score_proximite_lycee: number | null; score_proximite_cirfa: number | null;
      score_transport: number | null; score_demo: number | null;
      bonus_isochrone: number | null; poi_lycee_distance_min: number | null;
      poi_lycee_nom_proche: string | null;
      scoring_results: Record<string, { score: number; poids: number; distance?: number; nom?: string; valeur?: number }> | null;
      scoring_profile_id: string | null; score_computed_at: string | null;
    }>;

    const scores = panneaux.map(p => p.score_ooh_final ?? 0);
    const total = panneaux.length;
    const scoreMoyen = scores.reduce((a, b) => a + b, 0) / total;
    const scoreMax = Math.max(...scores);

    // Tiers: Top (>=80), Moyen (50-79), Faible (<50)
    const topCount = scores.filter(s => s >= 80).length;
    const moyenCount = scores.filter(s => s >= 50 && s < 80).length;
    const faibleCount = scores.filter(s => s < 50).length;

    // Histogram (buckets 0-10, 10-20, ..., 90-100)
    const histogram: { range: string; count: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const min = i * 10;
      const max = min + 10;
      histogram.push({
        range: `${min}-${max}`,
        count: scores.filter(s => s >= min && (i === 9 ? s <= max : s < max)).length,
      });
    }

    // Scatter: score vs poi_lycee_distance_min (top 200 for perf)
    const scatter = panneaux.slice(0, 200).map(p => ({
      id: p.id,
      score: p.score_ooh_final ?? 0,
      distance_lycee: p.poi_lycee_distance_min ?? null,
      nom: p.reference_panneau ?? p.id,
    }));

    // Top 5
    const top_panneaux = panneaux.slice(0, 5).map(p => ({
      id: p.id,
      nom: p.reference_panneau ?? `Panneau ${p.id.slice(0, 6)}`,
      score: p.score_ooh_final ?? 0,
      lat: p.lat,
      lng: p.lng,
      type_panneau: p.type_panneau,
      regie: p.regie,
      distance_lycee: p.poi_lycee_distance_min,
      lycee_proche: p.poi_lycee_nom_proche,
      scoring_results: p.scoring_results,
    }));

    // Radar — extract criterion scores from scoring_results
    // Build average over all panneaux and over top 20
    const top20 = panneaux.slice(0, 20);
    const criterionKeys = new Set<string>();
    for (const p of panneaux) {
      if (p.scoring_results) Object.keys(p.scoring_results).forEach(k => criterionKeys.add(k));
    }

    const radarData: Array<{ critere: string; top20: number; moyenne: number }> = [];
    for (const key of criterionKeys) {
      const allScores = panneaux
        .map(p => p.scoring_results?.[key]?.score ?? null)
        .filter((s): s is number => s !== null);
      const top20Scores = top20
        .map(p => p.scoring_results?.[key]?.score ?? null)
        .filter((s): s is number => s !== null);
      if (allScores.length === 0) continue;
      radarData.push({
        critere: key,
        top20: top20Scores.length ? top20Scores.reduce((a, b) => a + b, 0) / top20Scores.length : 0,
        moyenne: allScores.reduce((a, b) => a + b, 0) / allScores.length,
      });
    }

    // Fallback radar from legacy columns if no scoring_results
    if (radarData.length === 0) {
      const legacyCriteres = [
        { key: 'lycee', label: 'Lycée', field: 'score_proximite_lycee' as const },
        { key: 'cirfa', label: 'CIRFA', field: 'score_proximite_cirfa' as const },
        { key: 'transport', label: 'Transport', field: 'score_transport' as const },
        { key: 'demo', label: 'Démographie', field: 'score_demo' as const },
      ];
      for (const c of legacyCriteres) {
        const allS = panneaux.map(p => p[c.field] ?? 0);
        const top20S = top20.map(p => p[c.field] ?? 0);
        radarData.push({
          critere: c.label,
          top20: top20S.reduce((a, b) => a + b, 0) / top20S.length,
          moyenne: allS.reduce((a, b) => a + b, 0) / allS.length,
        });
      }
    }

    // Profile name
    let profileNom: string | null = null;
    if (panneaux[0]?.scoring_profile_id) {
      const { data: prof } = await supabase
        .from('scoring_profiles')
        .select('nom')
        .eq('id', panneaux[0].scoring_profile_id)
        .single();
      profileNom = prof?.nom ?? null;
    }

    return NextResponse.json({
      ville,
      total,
      scored_at: panneaux[0]?.score_computed_at ?? null,
      profile_nom: profileNom,
      kpis: {
        score_moyen: Math.round(scoreMoyen * 10) / 10,
        score_max: Math.round(scoreMax * 10) / 10,
        top_tier_count: topCount,
        top_tier_pct: Math.round((topCount / total) * 100),
      },
      tiers: [
        { tier: 'Top', range: '≥ 80', count: topCount, color: '#3dffa0' },
        { tier: 'Moyen', range: '50–79', count: moyenCount, color: '#a855f7' },
        { tier: 'Faible', range: '< 50', count: faibleCount, color: '#ef4444' },
      ],
      histogram,
      scatter,
      radar: radarData,
      top_panneaux,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
