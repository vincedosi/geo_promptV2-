/**
 * GET /api/poi-clusters/count
 *
 * Compte les POIs correspondant aux filtres du wizard (avant de lancer le clustering).
 *
 * Query params:
 *   poi_types        — CSV, ex: "cirfa,lycee"  (obligatoire)
 *   metropolitaine   — "true" | "false"  (défaut: true)
 *   regions          — CSV de codes région (ex: "ara,idf")
 *   depts            — CSV de codes département (ex: "75,69")
 *
 * Response: { count: number, poi_types: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// Codes département des DROM-COM (exclus si metropolitaine=true)
const DROM_COM_DEPTS = new Set(['971', '972', '973', '974', '975', '976']);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const poiTypesParam  = searchParams.get('poi_types');
  const metropolitaine = searchParams.get('metropolitaine') !== 'false';
  const regionsParam   = searchParams.get('regions');
  const deptsParam     = searchParams.get('depts');

  if (!poiTypesParam?.trim()) {
    return NextResponse.json({ error: 'poi_types requis' }, { status: 400 });
  }

  const poiTypes = poiTypesParam.split(',').map(s => s.trim()).filter(Boolean);
  const regions  = regionsParam  ? regionsParam.split(',').map(s => s.trim()).filter(Boolean)  : [];
  const depts    = deptsParam    ? deptsParam.split(',').map(s => s.trim()).filter(Boolean)     : [];

  const sb = createAdminClient();

  let q = sb.from('poi_france').select('id', { count: 'exact', head: true })
    .in('categorie', poiTypes);

  // Exclure DROM-COM via bounding box France métropolitaine
  if (metropolitaine) {
    q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
  }

  // Filtre par département (code_departement)
  if (depts.length > 0) {
    // Exclure aussi les DROM-COM si metropolitaine
    const filteredDepts = metropolitaine
      ? depts.filter(d => !DROM_COM_DEPTS.has(d))
      : depts;
    if (filteredDepts.length > 0) {
      q = q.in('code_departement', filteredDepts);
    }
  }

  const { count, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0, poi_types: poiTypes });
}
