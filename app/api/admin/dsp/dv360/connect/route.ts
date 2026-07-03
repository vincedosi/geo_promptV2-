/** MAGELIAN — POST/DELETE /api/admin/dsp/dv360/connect : enregistre/supprime la connexion Service Account. */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { dv360ConnectSchema } from '@/lib/dsp/validation';
import { parseServiceAccount } from '@/lib/dsp/dv360/auth';
import { encryptSecret } from '@/lib/crypto/secrets';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const parsed = dv360ConnectSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Body invalide.' }, { status: 400 });
  }
  const { partner_id, service_account_json } = parsed.data;

  // Valide la structure de la clé AVANT chiffrement (échoue vite si mauvais JSON)
  try {
    parseServiceAccount(service_account_json);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('dsp_connections').upsert({
    organization_id: orgId,
    provider: 'dv360',
    auth_method: 'service_account',
    status: 'disconnected',
    partner_id,
    credentials_encrypted: encryptSecret(service_account_json),
    oauth_refresh_token_encrypted: null,
    last_error: null,
    created_by: profile.id,
  }, { onConflict: 'organization_id,provider' });

  if (error) {
    console.error('[POST dv360/connect]', error.message);
    return NextResponse.json({ error: 'Erreur enregistrement.' }, { status: 500 });
  }

  await logDspEvent({
    orgId, provider: 'dv360', category: 'connection', action: 'connect_service_account',
    message: `Service Account enregistré (partner ${partner_id})`,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const supabase = createAdminClient();

  // ?scope=full → purge complète : supprime la ligne entière, y compris le
  // client OAuth (Client ID + Secret chiffré) et le partner_id. Sinon,
  // déconnexion simple : révoque les credentials mais conserve la config.
  const full = new URL(request.url).searchParams.get('scope') === 'full';

  const { error } = full
    ? await supabase.from('dsp_connections').delete()
        .eq('organization_id', orgId).eq('provider', 'dv360')
    : await supabase.from('dsp_connections').update({
        status: 'disconnected',
        auth_method: null,
        credentials_encrypted: null,
        oauth_refresh_token_encrypted: null,
        token_expires_at: null,
        advertiser_ids: [],
        last_error: null,
      }).eq('organization_id', orgId).eq('provider', 'dv360');

  if (error) {
    console.error('[DELETE dv360/connect]', error.message);
    return NextResponse.json({ error: 'Erreur déconnexion.' }, { status: 500 });
  }

  await logDspEvent({
    orgId, provider: 'dv360', category: 'connection',
    action: full ? 'purge_auth' : 'disconnect',
    message: full ? 'Données d\'authentification DV360 effacées' : 'Connexion DV360 supprimée',
  });
  return NextResponse.json({ ok: true });
}
