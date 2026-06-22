/** MAGELIAN — GET /api/admin/dsp/dv360/oauth/start : redirige vers le consentement Google. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { buildAuthUrl } from '@/lib/dsp/dv360/auth';
import { signState } from '@/lib/dsp/oauth-state';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });
  }
  try {
    return NextResponse.redirect(buildAuthUrl(signState(profile.organization_id)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
