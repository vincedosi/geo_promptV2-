/**
 * GET /api/dsp/dv360/resources?campaignId=<magelian>&advertiserId=&dv360CampaignId=
 *
 * Listing en cascade pour la liaison DV360 de l'étape Canaux :
 *   • campaignId seul                → annonceurs du partner de la connexion
 *   • + advertiserId                 → campagnes DV360 de l'annonceur
 *   • + advertiserId + dv360CampaignId → insertion orders de la campagne
 *
 * La connexion utilisée est celle de l'org PROPRIÉTAIRE de la campagne
 * MAGELIAN (provider dv360, status connected) — pas celle de l'utilisateur.
 * Auth : requireAuth + checkCampaignAccess (owner-ou-lié, super_admin global).
 * I/O : appels Google uniquement (aucune table volumineuse Supabase).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import {
  resolveAccessToken, listAdvertisers, listCampaigns, listInsertionOrders,
  type Dv360ConnectionRow,
} from '@/lib/dsp/dv360/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ID_RE = /^\d{1,20}$/;

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');
  const advertiserId = searchParams.get('advertiserId');
  const dv360CampaignId = searchParams.get('dv360CampaignId');
  if (!campaignId) return NextResponse.json({ error: 'missing_campaignId' }, { status: 400 });
  if (advertiserId && !ID_RE.test(advertiserId)) return NextResponse.json({ error: 'invalid_advertiserId' }, { status: 400 });
  if (dv360CampaignId && !ID_RE.test(dv360CampaignId)) return NextResponse.json({ error: 'invalid_dv360CampaignId' }, { status: 400 });

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data: camp } = await supabase
    .from('dsp_campaigns')
    .select('organization_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (!camp) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data: conn, error: connErr } = await supabase
    .from('dsp_connections')
    .select('partner_id, auth_method, credentials_encrypted, oauth_refresh_token_encrypted, oauth_client_id, oauth_client_secret_encrypted')
    .eq('organization_id', camp.organization_id)
    .eq('provider', 'dv360')
    .eq('status', 'connected')
    .maybeSingle();
  if (connErr) return NextResponse.json({ error: connErr.message }, { status: 500 });
  if (!conn) return NextResponse.json({ error: 'dv360_not_connected' }, { status: 409 });

  const partnerId = (conn as { partner_id?: string | null }).partner_id;

  try {
    const token = await resolveAccessToken(conn as Dv360ConnectionRow);

    if (advertiserId && dv360CampaignId) {
      const items = await listInsertionOrders(token, advertiserId, dv360CampaignId);
      return NextResponse.json({ level: 'insertion_orders', items });
    }
    if (advertiserId) {
      const items = await listCampaigns(token, advertiserId);
      return NextResponse.json({ level: 'campaigns', items });
    }
    if (!partnerId) return NextResponse.json({ error: 'partner_id_missing' }, { status: 409 });
    const items = await listAdvertisers(token, partnerId);
    return NextResponse.json({ level: 'advertisers', items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur DV360';
    // Erreur côté Google (droits, quota…) — 502, message court sans secret.
    return NextResponse.json({ error: 'dv360_api_error', detail: message.slice(0, 300) }, { status: 502 });
  }
}
