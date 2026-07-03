/**
 * MAGELIAN — /api/admin/dsp/tiktok/connect
 * POST : enregistre l'app développeur TikTok de l'org (App ID + Secret chiffré).
 * DELETE : déconnecte (efface le token) ; ?scope=full efface aussi l'app.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { encryptSecret } from '@/lib/crypto/secrets';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

const ConnectSchema = z.object({
  app_id: z.string().min(1).max(64),
  app_secret: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const parsed = ConnectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'App ID et App Secret requis.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('dsp_connections').upsert({
    organization_id: orgId,
    provider: 'tiktok',
    auth_method: 'oauth',
    status: 'disconnected',
    oauth_client_id: parsed.data.app_id.trim(),
    oauth_client_secret_encrypted: encryptSecret(parsed.data.app_secret.trim()),
    created_by: profile.id,
  }, { onConflict: 'organization_id,provider' });

  if (error) {
    console.error('[POST tiktok/connect]', error.message);
    return NextResponse.json({ error: 'Erreur enregistrement.' }, { status: 500 });
  }

  await logDspEvent({
    orgId, provider: 'tiktok', category: 'connection', action: 'save_app',
    message: 'App TikTok enregistrée (App ID + Secret chiffré)',
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const full = new URL(request.url).searchParams.get('scope') === 'full';
  const supabase = createAdminClient();

  const { error } = full
    ? await supabase.from('dsp_connections')
        .delete()
        .eq('organization_id', orgId).eq('provider', 'tiktok')
    : await supabase.from('dsp_connections')
        .update({ oauth_refresh_token_encrypted: null, status: 'disconnected', last_error: null, advertiser_ids: [] })
        .eq('organization_id', orgId).eq('provider', 'tiktok');

  if (error) {
    console.error('[DELETE tiktok/connect]', error.message);
    return NextResponse.json({ error: 'Erreur déconnexion.' }, { status: 500 });
  }

  await logDspEvent({
    orgId, provider: 'tiktok', category: 'connection', action: full ? 'purge_auth' : 'disconnect',
    message: full ? 'Données d\'authentification TikTok effacées' : 'TikTok déconnecté',
  });
  return NextResponse.json({ ok: true });
}
