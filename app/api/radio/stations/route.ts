/**
 * GET /api/radio/stations
 * Liste des radios avec stats agrégées. Accessible à tous les authentifiés.
 * Query params: categorie_arcom, portee, genre, search, page, limit
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
  const page = Math.max(1, parseInt(p.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(p.get('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const supabase = createAdminClient();

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

  return NextResponse.json({
    stations: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}
