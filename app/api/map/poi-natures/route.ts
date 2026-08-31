import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/map/poi-natures?categorie=lycee
// Retourne les valeurs distinctes de metadata->>'libelle_nature' pour une catégorie POI
export async function GET(req: NextRequest) {
  const categorie = req.nextUrl.searchParams.get('categorie');
  if (!categorie) return NextResponse.json({ natures: [] });

  const supabase = createAdminClient();
  const PAGE = 1000;
  const naturesSet = new Set<string>();

  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('poi_france')
      .select('metadata')
      .eq('categorie', categorie)
      .not('metadata', 'is', null)
      .range(from, from + PAGE - 1);

    if (error || !data?.length) break;

    for (const row of data) {
      const nature = (row.metadata as Record<string, string>)?.libelle_nature;
      if (nature && typeof nature === 'string') naturesSet.add(nature);
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  return NextResponse.json({ natures: Array.from(naturesSet).sort() });
}
