/**
 * GET /api/digital/campaigns
 * List DSP campaigns scoped by user's organization.
 * super_admin with no org → all campaigns
 * user with org → only their org's campaigns
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest, isSuperAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function createNoCacheClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }) },
    }
  );
}

export async function GET(request: NextRequest) {
  const supabase = createNoCacheClient();

  // Get user profile for org scoping
  const authHeader = request.headers.get('authorization');
  const profile = await getUserFromRequest(authHeader);

  // Auth OBLIGATOIRE : sans profil, `orgId` restait null → la RPC renvoyait
  // TOUTES les campagnes de toutes les orgs (fuite non authentifiée). Fix.
  if (!profile) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 });
  }

  // Un non-super_admin SANS organisation ne voit rien : `p_organization_id`
  // null veut dire « toutes les campagnes » pour la RPC (sql/094), et ce cas
  // l'y envoyait jusqu'au 2026-10-08.
  if (!isSuperAdmin(profile) && !profile.organization_id) {
    return NextResponse.json([]);
  }

  // Determine org filter
  let orgId: string | null = null;
  if (profile && !isSuperAdmin(profile)) {
    // Non-admin users only see their org's campaigns
    orgId = profile.organization_id;
  } else if (profile && isSuperAdmin(profile) && profile.organization_id) {
    // Super admin with an org sees all (orgId stays null)
    orgId = null;
  }

  const { data, error } = await supabase.rpc('get_digital_campaigns_list', {
    p_organization_id: orgId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const brutes = typeof data === 'string' ? JSON.parse(data) : (data ?? []);

  // Les campagnes simulées (étape ⑤ du module risque, sql/232) sont écartées
  // ICI plutôt que dans la RPC : la réécrire pour un filtre ferait courir un
  // risque sur une fonction lue par quatre écrans. Une lecture d'index partiel.
  const { data: simulees, error: erreurSimulees } = await supabase
    .from('dsp_campaigns').select('id').eq('est_simulation', true);
  if (erreurSimulees) {
    return NextResponse.json({ error: erreurSimulees.message }, { status: 500 });
  }
  const aExclure = new Set((simulees ?? []).map((c) => c.id));
  const rows = brutes.filter((c: { id: string }) => !aExclure.has(c.id));

  // Last data date per campaign — signal d'attention (statut & cycle de vie).
  // RPC bornée par les ids affichés → index scan, jamais de scan intégral de
  // dsp_campaign_data (contrainte I/O Nano). Cf sql/095.
  const ids = rows.map((c: { id: string }) => c.id);
  const { data: lastDates } = ids.length
    ? await supabase.rpc('get_campaign_last_data_dates', { p_ids: ids })
    : { data: [] };
  const lastByCampaign = new Map<string, string>(
    (lastDates ?? []).map((r: { campaign_id: string; last_data_date: string }) => [r.campaign_id, r.last_data_date])
  );
  const items = rows.map((c: { id: string }) => ({
    ...c,
    last_data_date: lastByCampaign.get(c.id) ?? null,
  }));

  return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
}
