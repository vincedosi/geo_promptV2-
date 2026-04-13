/**
 * GENESIS — DELETE /api/admin/campaigns/[id]/organizations/[orgId]
 * Remove an organization from a DSP campaign (cannot remove owner or last org).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; orgId: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id, orgId } = await params;
  const supabase = createAdminClient();

  const { data: campaign } = await supabase
    .from('dsp_campaigns')
    .select('id, organization_id')
    .eq('id', id)
    .single();
  if (!campaign) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  }

  if (campaign.organization_id === orgId) {
    return NextResponse.json(
      { error: "Impossible de retirer l'organisation propriétaire" },
      { status: 400 }
    );
  }

  const { count: linkCount } = await supabase
    .from('campaign_organizations')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id);

  if ((linkCount ?? 0) <= 1) {
    return NextResponse.json(
      { error: 'Une campagne doit rester liée à au moins une organisation' },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from('campaign_organizations')
    .delete()
    .eq('campaign_id', id)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
