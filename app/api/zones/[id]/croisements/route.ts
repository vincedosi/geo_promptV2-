/**
 * GET /api/zones/[id]/croisements — les émetteurs radio dont le cercle touche une zone de l'espace actif et les
 * comptages routiers qui la traversent (lot 4, T13 ; `croisements_zone`, sql/273). Une lecture.
 *
 * Ordre (patron de T6, `../couverture/route.ts`) : session (401 / 403) → id UUID (400, rien en base) → quota
 * `geo:rl:couverture`, PARTAGÉ avec T6 (`quotaCouverture`) → RPC. L'espace vient de la SESSION, jamais du client.
 * Zone ≤ 100 000 km² (`zone_trop_vaste`, 422). Au pire mesuré (zone `919ca65d`, 23 073 sommets) 1,7 s et ≈ 3 300
 * accès par appel. Statuts : `repondreCouverture`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { espaceDeZone } from '@/lib/zones/session-zones';
import { MESSAGES_REFUS_COUVERTURE, quotaCouverture, repondreCouverture } from '@/lib/zones/couverture';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ECHEC = 'Lecture de la radio et du trafic impossible.';
const { zone_introuvable, zone_trop_vaste } = MESSAGES_REFUS_COUVERTURE;
const MESSAGES = { zone_introuvable, zone_trop_vaste } as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant de zone invalide.' }, { status: 400 });
  }

  const refusQuota = await quotaCouverture(s.espace.userId);
  if (refusQuota) return refusQuota;

  const { data, error } = await createAdminClient().rpc('croisements_zone', { p_zone_id: id, p_org_id: s.espace.orgId });
  if (error) {
    console.error('[zones/croisements]', error.code, error.message);
    return NextResponse.json({ error: ECHEC }, { status: 500 });
  }
  return repondreCouverture(data, MESSAGES, 'zones/croisements', ECHEC);
}
