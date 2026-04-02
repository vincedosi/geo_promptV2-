/**
 * GET /api/radio/stations
 * Liste des radios avec nombre d'émetteurs. Accessible à tous les authentifiés.
 * Query params: categorie_arcom, portee, genre, search, filter (all|matched|unmatched),
 *               sort (nom|freq_desc), page, limit
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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

  // Fetch all radios with emitter count (no pagination at DB level — we sort/filter in JS)
  let query = supabase
    .from('radios')
    .select('*, emetteurs_radio(count)', { count: 'exact' })
    .limit(5000);

  if (categorie) query = query.eq('categorie_arcom', categorie);
  if (portee) query = query.eq('portee', portee);
  if (genre) query = query.eq('genre', genre);
  if (search) query = query.ilike('nom', `%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Transform + compute fields
  let stations = (data ?? []).map((r: Record<string, unknown>) => {
    const emCount = (r.emetteurs_radio as Array<{ count: number }> | null);
    const meta = r.metadata as Record<string, unknown> | null;
    const freqsFm = meta?.frequences_fm;
    const nbFreqFm = Array.isArray(freqsFm) ? freqsFm.length : 0;
    return {
      ...r,
      nb_emetteurs: emCount?.[0]?.count ?? 0,
      nb_freq_fm: nbFreqFm,
      emetteurs_radio: undefined,
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
