/**
 * MAGELIAN — GET /api/admin/dsp/tiktok/config : diagnostic config serveur TikTok.
 * Présence des env vars en booléens (jamais de secret) + redirect URI en clair.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { getTiktokRedirectUri } from '@/lib/dsp/tiktok/client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();

  const redirectUri = getTiktokRedirectUri();
  return NextResponse.json({
    env: {
      enc_key: Boolean(process.env.DSP_ENC_KEY),
      app_id: Boolean(process.env.TIKTOK_APP_ID),
      app_secret: Boolean(process.env.TIKTOK_APP_SECRET),
      redirect_uri: Boolean(redirectUri),
      redirect_uri_value: redirectUri,
    },
  });
}
