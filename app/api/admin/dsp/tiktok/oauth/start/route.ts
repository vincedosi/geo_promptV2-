/**
 * MAGELIAN — POST /api/admin/dsp/tiktok/oauth/start : prépare le flux OAuth TikTok.
 * Appelé en XHR (adminFetch), renvoie l'URL de consentement en JSON (le client
 * fait window.location lui-même — une navigation directe n'aurait pas le Bearer).
 * App ID : saisi par org (oauth_client_id) ou fallback env TIKTOK_APP_ID.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { buildTiktokAuthUrl, getTiktokRedirectUri } from '@/lib/dsp/tiktok/client';
import { signState } from '@/lib/dsp/oauth-state';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: conn } = await supabase
    .from('dsp_connections')
    .select('oauth_client_id')
    .eq('organization_id', orgId).eq('provider', 'tiktok').single();

  const appId = conn?.oauth_client_id ?? process.env.TIKTOK_APP_ID ?? null;
  if (!appId) {
    return NextResponse.json(
      { error: 'App ID TikTok manquant : enregistre d\'abord l\'app (App ID + Secret).' },
      { status: 400 },
    );
  }

  const redirectUri = getTiktokRedirectUri();
  if (!redirectUri) {
    return NextResponse.json(
      { error: 'Redirect URI introuvable : définir TIKTOK_OAUTH_REDIRECT_URI ou NEXT_PUBLIC_APP_URL.' },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json({ url: buildTiktokAuthUrl(appId, signState(orgId), redirectUri) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
