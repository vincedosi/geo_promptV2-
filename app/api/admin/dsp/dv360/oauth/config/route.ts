/**
 * MAGELIAN — POST /api/admin/dsp/dv360/oauth/config : enregistre le client OAuth
 * (Client ID + Client Secret) saisi via formulaire, par organisation.
 *
 * Le secret est chiffré AES-256-GCM avant stockage. Permet de tester DV360 sans
 * toucher au .env : si ces valeurs sont présentes, elles priment sur les env vars.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { dv360OAuthConfigSchema } from '@/lib/dsp/validation';
import { encryptSecret } from '@/lib/crypto/secrets';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const parsed = dv360OAuthConfigSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Body invalide.' }, { status: 400 });
  }
  const { partner_id, oauth_client_id, oauth_client_secret } = parsed.data;

  const supabase = createAdminClient();
  const { error } = await supabase.from('dsp_connections').upsert({
    organization_id: orgId,
    provider: 'dv360',
    auth_method: 'oauth',
    status: 'disconnected',
    partner_id,
    oauth_client_id,
    oauth_client_secret_encrypted: encryptSecret(oauth_client_secret),
    last_error: null,
    created_by: profile.id,
  }, { onConflict: 'organization_id,provider' });

  if (error) {
    console.error('[POST dv360/oauth/config]', error.message);
    return NextResponse.json({ error: 'Erreur enregistrement config OAuth.' }, { status: 500 });
  }

  await logDspEvent({
    orgId, provider: 'dv360', category: 'connection', action: 'oauth_config_saved',
    message: `Client OAuth enregistré (partner ${partner_id})`,
  });

  return NextResponse.json({ ok: true });
}
