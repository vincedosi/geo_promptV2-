/**
 * GET /api/ref/geo
 *
 * Source de vérité des régions/départements INSEE depuis la DB (ref_regions
 * + ref_departements). Remplace l'usage de lib/geo/france-admin.ts pour
 * les opérations qui doivent passer des codes INSEE à la couche serveur
 * (territory-mask, admin_scope, etc.).
 *
 * Auth : session (JWT local, pas de coût I/O).
 * Cache : public max-age=3600 (données stables, changent à peine 1x/10 ans).
 *
 * Shape de retour :
 *   {
 *     regions: Array<{
 *       code_region: string;   // INSEE '11', '53', '76', '84', ...
 *       nom_region:  string;   // 'Île-de-France', 'Bretagne', ...
 *       depts: Array<{
 *         code_dept: string;   // '75', '35', '2A', ...
 *         nom_dept:  string;
 *       }>;
 *     }>
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface DeptRow { code_dept: string; nom_dept: string; code_region: string }
interface RegionRow { code_region: string; nom_region: string }

export async function GET(_req: NextRequest) {
  const supabase = createAdminClient();

  const [{ data: regionsData, error: regionsErr }, { data: deptsData, error: deptsErr }] = await Promise.all([
    supabase.from('ref_regions')
      .select('code_region, nom_region')
      .order('nom_region'),
    supabase.from('ref_departements')
      .select('code_dept, nom_dept, code_region')
      .order('code_dept'),
  ]);

  if (regionsErr) return NextResponse.json({ error: regionsErr.message }, { status: 500 });
  if (deptsErr)   return NextResponse.json({ error: deptsErr.message   }, { status: 500 });

  const regions = (regionsData as RegionRow[] | null) ?? [];
  const depts   = (deptsData   as DeptRow[]   | null) ?? [];

  const deptsByRegion = new Map<string, Array<{ code_dept: string; nom_dept: string }>>();
  for (const d of depts) {
    if (!deptsByRegion.has(d.code_region)) deptsByRegion.set(d.code_region, []);
    deptsByRegion.get(d.code_region)!.push({ code_dept: d.code_dept, nom_dept: d.nom_dept });
  }

  const payload = {
    regions: regions.map(r => ({
      code_region: r.code_region,
      nom_region:  r.nom_region,
      depts:       deptsByRegion.get(r.code_region) ?? [],
    })),
  };

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  });
}
