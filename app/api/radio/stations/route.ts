/**
 * GET /api/radio/stations
 * Liste des radios avec nombre d'émetteurs. Accessible à tous les authentifiés.
 * Query params: categorie_arcom, portee, genre, search, filter (all|matched|unmatched),
 *               sort (nom|freq_desc), page, limit
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { lireTout } from '@/lib/supabase/lire-tout';

export const dynamic = 'force-dynamic';

/** Nombre maximal de radios lues (1 175 le 2026-10-10). Borne I/O : au-delà, échec plutôt que troncature. */
const PLAFOND_RADIOS = 5000;

export async function GET(req: NextRequest) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();
  const p = req.nextUrl.searchParams;
  const categorie = p.get('categorie_arcom');
  const portee = p.get('portee');
  const genre = p.get('genre');
  const search = p.get('search');
  const filter = p.get('filter') ?? 'all'; // all | matched | unmatched
  const sort = p.get('sort') ?? 'freq_desc'; // nom | freq_desc
  const page = Math.max(1, parseInt(p.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(p.get('limit') ?? '50', 10)));

  const supabase = createAdminClient();

  // Fetch radios (no embedded count — unreliable with self-join + supabase-js 2.97)
  // Lecture PAGINÉE : PostgREST plafonne toute requête de table à 1 000 lignes
  // (`db-max-rows`) ; l'ancien `.limit(5000)` rendait 1 000 radios sur 1 175 et
  // un `total` faux (mesuré le 2026-10-10). Borne : PLAFOND_RADIOS, au-delà la
  // lecture échoue au lieu de tronquer. `order('id')` : pages sans recouvrement.
  const construire = (de: number, a: number) => {
    let query = supabase
      .from('radios')
      .select('*, parent:radios!parent_radio_id(id, nom)')
      .order('id');

    if (categorie) query = query.eq('categorie_arcom', categorie);
    if (portee) query = query.eq('portee', portee);
    if (genre) query = query.eq('genre', genre);
    if (search) query = query.ilike('nom', `%${search}%`);
    return query.range(de, a);
  };

  // Fetch emitter counts separately (reliable subquery via RPC-style SQL)
  const [radiosResult, countsResult] = await Promise.all([
    lireTout(construire, PLAFOND_RADIOS).then(
      ({ lignes }) => ({ data: lignes, error: null }),
      (err: unknown) => ({ data: null, error: err instanceof Error ? err : new Error(String(err)) }),
    ),
    supabase.rpc('count_emetteurs_par_radio'),
  ]);

  if (radiosResult.error) {
    console.error('[api/radio/stations] erreur:', radiosResult.error.message);
    return NextResponse.json({ error: 'Lecture des radios impossible.' }, { status: 500 });
  }

  // Build radio_id → count map
  const emCountMap = new Map<string, number>();
  if (countsResult.data) {
    for (const row of countsResult.data as Array<{ radio_id: string; nb: number }>) {
      emCountMap.set(row.radio_id, row.nb);
    }
  }

  // Transform + compute fields
  let stations = (radiosResult.data ?? []).map((r: Record<string, unknown>) => {
    const meta = r.metadata as Record<string, unknown> | null;
    const freqsFm = meta?.frequences_fm;
    const nbFreqFm = Array.isArray(freqsFm) ? freqsFm.length : 0;
    const parentArr = r.parent as Array<{ id: string; nom: string }> | { id: string; nom: string } | null;
    const parentObj = Array.isArray(parentArr) ? parentArr[0] : parentArr;
    return {
      ...r,
      nb_emetteurs: emCountMap.get(r.id as string) ?? 0,
      nb_freq_fm: nbFreqFm,
      parent_nom: parentObj?.nom ?? null,
      parent: undefined,
    };
  });

  // Filter
  if (filter === 'matched') stations = stations.filter(s => (s.nb_emetteurs as number) > 0);
  if (filter === 'unmatched') stations = stations.filter(s => (s.nb_emetteurs as number) === 0);

  // Sort
  if (sort === 'freq_desc') {
    stations.sort((a, b) => (b.nb_freq_fm as number) - (a.nb_freq_fm as number));
  } else {
    stations.sort((a, b) => String((a as Record<string, unknown>).nom ?? '').localeCompare(String((b as Record<string, unknown>).nom ?? '')));
  }

  // Paginate
  const total = stations.length;
  const offset = (page - 1) * limit;
  const paged = stations.slice(offset, offset + limit);

  return NextResponse.json({ stations: paged, total, page, limit });
}
