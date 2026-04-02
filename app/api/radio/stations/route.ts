/**
 * GET /api/radio/stations
 * Liste des radios avec nombre d'émetteurs. Accessible à tous les authentifiés.
 * Query params: categorie_arcom, portee, genre, search, unmatched, page, limit
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
  const unmatched = p.get('unmatched') === '1';
  const page = Math.max(1, parseInt(p.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(p.get('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const supabase = createAdminClient();

  // Use RPC for unmatched filter (PostgREST can't filter on aggregate count)
  if (unmatched) {
    const { data, error } = await supabase.rpc('get_unmatched_radios' as never, {
      p_search: search ?? null,
      p_categorie: categorie ?? null,
      p_limit: limit,
      p_offset: offset,
    } as never);

    if (error) {
      // Fallback if RPC doesn't exist — return all radios
      // (RPC will be created in migration)
    } else {
      return NextResponse.json({
        stations: data ?? [],
        total: (data as unknown[])?.length ?? 0,
        page, limit,
      });
    }
  }

  let query = supabase
    .from('radios')
    .select('*, emetteurs_radio(count)', { count: 'exact' })
    .order('nom', { ascending: true })
    .range(offset, offset + limit - 1);

  if (categorie) query = query.eq('categorie_arcom', categorie);
  if (portee) query = query.eq('portee', portee);
  if (genre) query = query.eq('genre', genre);
  if (search) query = query.ilike('nom', `%${search}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Transform emetteurs_radio count from nested array to flat number
  const stations = (data ?? []).map((r: Record<string, unknown>) => {
    const emCount = (r.emetteurs_radio as Array<{ count: number }> | null);
    return {
      ...r,
      nb_emetteurs: emCount?.[0]?.count ?? 0,
      emetteurs_radio: undefined, // remove nested object
    };
  });

  return NextResponse.json({ stations, total: count ?? 0, page, limit });
}
