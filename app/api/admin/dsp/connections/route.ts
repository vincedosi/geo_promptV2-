/** MAGELIAN — GET /api/admin/dsp/connections : statut des connexions DSP de l'org. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import type { DspConnectionPublic } from '@/types/dsp';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation associée au profil.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('dsp_connections')
    .select('provider, auth_method, status, partner_id, advertiser_ids, token_expires_at, last_error, updated_at')
    .eq('organization_id', profile.organization_id);

  if (error) {
    console.error('[GET dsp/connections]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const connections = (data ?? []) as DspConnectionPublic[];
  return NextResponse.json({ connections }, { headers: { 'Cache-Control': 'no-store' } });
}
