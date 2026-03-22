import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET /api/scoring/poi-categories
// Retourne les catégories POI disponibles avec leurs comptages
export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('poi_france')
      .select('categorie, sous_categorie')
      .not('categorie', 'is', null);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Agréger par catégorie côté JS
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const key = row.categorie as string;
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const categories = Object.entries(counts)
      .map(([categorie, count]) => ({ categorie, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ categories });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
