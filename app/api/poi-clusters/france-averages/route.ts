/**
 * GET /api/poi-clusters/france-averages
 * Retourne les moyennes nationales Filosofi (référence radar clustering).
 * { averages: { [feature_name]: { avg, std, min, max, n_carreaux } }, computed_at }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

export const revalidate = 3600; // cache 1h

export async function GET(req: NextRequest) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('filosofi_national_averages')
    .select('feature_name, avg_value, std_value, min_value, max_value, n_carreaux, computed_at')
    .order('feature_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Moyennes non calculées — lancez --mode compute-france-averages' }, { status: 404 });

  const averages: Record<string, { avg: number; std: number; min: number; max: number; n_carreaux: number }> = {};
  let computed_at = '';
  for (const row of data) {
    averages[row.feature_name] = {
      avg:       Number(row.avg_value),
      std:       Number(row.std_value),
      min:       Number(row.min_value),
      max:       Number(row.max_value),
      n_carreaux: Number(row.n_carreaux),
    };
    computed_at = row.computed_at;
  }

  return NextResponse.json({ averages, computed_at });
}
