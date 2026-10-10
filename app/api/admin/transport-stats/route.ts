import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

import { lireTout } from '@/lib/supabase/lire-tout';

export const dynamic = 'force-dynamic';

/** Borne de la lecture des panneaux (1 434 en base le 2026-10-10), même valeur que `/api/map/ooh`. */
const PLAFOND_PANNEAUX = 5000;

export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();

  // ⛔ Nano : ces trois COUNT exact portent sur des tables volumineuses
  // (poi_france ~285k arrets, comptages_routiers ~408k lignes x2). Les lancer
  // en parallele est exactement le motif de l'incident du 08/04 consigne dans
  // CLAUDE.md (3 COUNT sur 280k lignes -> timeout). On les SEQUENCE donc :
  // memes requetes, memes resultats, concurrence ramenee a 1.
  // Arrêts transport — COUNT exact (évite le plafond PostgREST `db-max-rows`,
  // 1 000 lignes sur le stack local)
  const arretTotal = await supabase
    .from('poi_france').select('*', { count: 'exact', head: true }).eq('categorie', 'arret_transport');
  // Flux CEREMA — COUNT exact
  const ceremaCount = await supabase
    .from('comptages_routiers').select('*', { count: 'exact', head: true }).eq('source', 'tmja_rrn_national');
  // Flux OSM — COUNT exact
  const osmCount = await supabase
    .from('comptages_routiers').select('*', { count: 'exact', head: true }).eq('source', 'osm_highway_proxy');
  // Scoring panneaux — lecture PAGINÉE. PostgREST coupe une table à
  // `db-max-rows` = 1 000 lignes et l'ancien `.limit(5000)` ne levait rien :
  // 1 000 panneaux comptés sur 1 434 (mesuré le 2026-10-10). `order('id')` :
  // ordre total, deux pages ne se recouvrent pas. Au-delà de PLAFOND_PANNEAUX,
  // la lecture échoue au lieu de tronquer.
  let panneaux: { data: unknown[] };
  try {
    const { lignes } = await lireTout(
      (de, a) => supabase
        .from('panneaux_affichage')
        .select('ville, score_transport, score_flux_routier, score_ooh_total')
        .order('id')
        .range(de, a),
      PLAFOND_PANNEAUX,
    );
    panneaux = { data: lignes };
  } catch (e) {
    console.error('[admin/transport-stats] panneaux', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'Lecture des panneaux impossible.' }, { status: 500 });
  }

  // Sources connues — agrégation directe depuis les counts
  const arretsBySource: Record<string, number> = {
    gtfs_consolidated_france: arretTotal.count ?? 0,
  };

  const fluxBySource: Record<string, number> = {
    tmja_rrn_national: ceremaCount.count ?? 0,
    osm_highway_proxy: osmCount.count ?? 0,
  };

  // Stats panneaux
  const rows = (panneaux.data ?? []) as {
    ville: string; score_transport: number | null;
    score_flux_routier: number | null; score_ooh_total: number | null;
  }[];

  const total = rows.length;
  const avec_transport = rows.filter((r) => (r.score_transport ?? 0) > 0).length;
  const avec_flux = rows.filter((r) => (r.score_flux_routier ?? 0) > 0).length;

  // Agrégation par ville
  const villeMap: Record<string, { nb: number; transport: number[]; flux: number[]; total: number[] }> = {};
  for (const r of rows) {
    const v = r.ville ?? 'INCONNUE';
    if (!villeMap[v]) villeMap[v] = { nb: 0, transport: [], flux: [], total: [] };
    villeMap[v].nb++;
    villeMap[v].transport.push(r.score_transport ?? 0);
    villeMap[v].flux.push(r.score_flux_routier ?? 0);
    villeMap[v].total.push(r.score_ooh_total ?? 0);
  }

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;

  const villes = Object.entries(villeMap)
    .map(([ville, d]) => ({
      ville,
      nb_panneaux: d.nb,
      avec_transport: d.transport.filter((x) => x > 0).length,
      transport_moyen: avg(d.transport),
      avec_flux: d.flux.filter((x) => x > 0).length,
      flux_moyen: avg(d.flux),
      score_moyen: avg(d.total),
    }))
    .sort((a, b) => b.nb_panneaux - a.nb_panneaux)
    .slice(0, 30);

  return NextResponse.json({
    success: true,
    arrets: {
      total: Object.values(arretsBySource).reduce((a, b) => a + b, 0),
      by_source: arretsBySource,
    },
    flux: {
      total: Object.values(fluxBySource).reduce((a, b) => a + b, 0),
      by_source: fluxBySource,
    },
    panneaux: { total, avec_transport, avec_flux },
    villes,
  });
}
