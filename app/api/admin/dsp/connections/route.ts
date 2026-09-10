/** MAGELIAN — GET /api/admin/dsp/connections : statut des connexions DSP de l'org. */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import type { DspConnectionPublic, DspProvider, DspAuthMethod, DspStatus } from '@/types/dsp';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation associée au profil.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('dsp_connections')
    .select('provider, auth_method, status, partner_id, oauth_client_id, advertiser_ids, token_expires_at, last_error, updated_at, credentials_encrypted, oauth_refresh_token_encrypted')
    .eq('organization_id', profile.organization_id);

  if (error) {
    console.error('[GET dsp/connections]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  // Mapping explicite : les colonnes chiffrées ne servent qu'à calculer le
  // booléen has_credentials et ne sont JAMAIS renvoyées au client.
  //
  // `provider`, `auth_method` et `status` sont des colonnes `text` + CHECK : le
  // generateur les rend en `string`, les unions de types/dsp.ts reprennent
  // exactement les valeurs des contraintes `dsp_connections_*_check` (verifie
  // 2026-09-10). `advertiser_ids` est du jsonb ecrit par nos propres routes.
  const connections: DspConnectionPublic[] = (data ?? []).map((row) => ({
    provider: row.provider as DspProvider,
    auth_method: row.auth_method as DspAuthMethod | null,
    status: row.status as DspStatus,
    partner_id: row.partner_id,
    oauth_client_id: row.oauth_client_id,
    has_credentials: Boolean(row.credentials_encrypted || row.oauth_refresh_token_encrypted),
    advertiser_ids: rpcJson<{ id: string; name: string }[]>(row.advertiser_ids) ?? [],
    token_expires_at: row.token_expires_at,
    last_error: row.last_error,
    updated_at: row.updated_at,
  }));
  return NextResponse.json({ connections }, { headers: { 'Cache-Control': 'no-store' } });
}
