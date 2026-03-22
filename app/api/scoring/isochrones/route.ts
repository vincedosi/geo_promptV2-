import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET /api/scoring/isochrones?ville=Brest
// Retourne les GeoJSON des isochrones en cache pour une ville, prêts pour MapLibre.
export async function GET(req: NextRequest) {
  try {
    const ville = new URL(req.url).searchParams.get('ville') ?? 'Brest';
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('isochrones_cache')
      .select('cache_key, categorie, minutes, mode, geojson')
      .ilike('ville', ville)
      .eq('mode', 'walk')
      .in('categorie', ['lycee', 'cirfa'])
      .in('minutes', [5, 10, 15])
      .not('geojson', 'is', null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Regrouper par catégorie + minutes pour l'overlay MapLibre
    type IsoEntry = {
      categorie: string;
      minutes: number;
      features: unknown[];
    };
    const entries: IsoEntry[] = (data ?? []).map(row => ({
      categorie: row.categorie as string,
      minutes:   row.minutes as number,
      features:  ((row.geojson as Record<string, unknown>)?.features as unknown[]) ?? [],
    }));

    return NextResponse.json({ isochrones: entries, ville });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
