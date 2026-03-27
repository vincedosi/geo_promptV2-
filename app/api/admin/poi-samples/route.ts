import { NextResponse } from 'next/server';
import { type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cat    = req.nextUrl.searchParams.get('cat') ?? '';
  const limit  = Math.min(parseInt(req.nextUrl.searchParams.get('limit')  ?? '50'), 200);
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0');
  const supabase = createAdminClient();

  let q = supabase
    .from('poi_france')
    .select('id, nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source', { count: 'exact' })
    .range(offset, offset + limit - 1);

  if (cat) {
    q = q.eq('categorie', cat);
  } else {
    q = q.neq('categorie', 'arret_transport');
  }

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, samples: data ?? [], total: count ?? 0, offset, limit });
}
