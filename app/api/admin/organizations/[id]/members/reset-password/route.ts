/**
 * POST /api/admin/organizations/[id]/members/reset-password
 * Génère un lien de reset password pour un membre
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { email } = await request.json();

  if (!email?.trim()) {
    return NextResponse.json({ success: false, error: 'Email requis' }, { status: 400 });
  }

  const { data, error } = await sb.auth.admin.generateLink({
    type: 'recovery',
    email: email.trim().toLowerCase(),
  });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const linkData = data as { properties?: { action_link?: string } } | null;
  return NextResponse.json({ success: true, link: linkData?.properties?.action_link ?? null });
}
