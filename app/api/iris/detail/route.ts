/**
 * GET /api/iris/detail?code_iris=75056_0101
 * Retourne toutes les colonnes socio-démographiques d'un IRIS donné.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';

export const dynamic = 'force-dynamic';

const SELECT_COLS = [
  'code_iris', 'nom_iris', 'code_commune', 'nom_commune', 'code_dept', 'is_true_iris',
  ...IRIS_DB_COLUMNS.filter(c => c.name !== 'is_true_iris').map(c => c.name),
].join(', ');

export async function GET(req: NextRequest) {
  const code_iris = req.nextUrl.searchParams.get('code_iris') ?? '';
  if (!code_iris || !/^\d{9}$/.test(code_iris)) {
    return NextResponse.json({ error: 'code_iris invalide' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('iris')
    .select(SELECT_COLS)
    .eq('code_iris', code_iris)
    .single();

  if (error) {
    console.error('[iris/detail]', error.message);
    return NextResponse.json({ error: 'IRIS introuvable' }, { status: 404 });
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
