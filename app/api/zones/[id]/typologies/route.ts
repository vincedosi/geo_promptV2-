/**
 * GET /api/zones/[id]/typologies — les typologies DÉJÀ calculées des POI d'une zone de l'espace actif, en lecture pour
 * tous (④ finitions, T4, arbitrage A-7 ; Excel n° 34). `typologies_de_zone` (sql/298) : pour le dernier modèle de
 * chaque (durée, mode), les POI visibles de l'espace situés dans la zone, leur typologie, la population couverte, et
 * le profil moyen de chaque typologie.
 *
 * Le CALCUL d'un modèle (`/api/poi-clusters/run`, script Python, ORS) reste réservé au super admin : cette route
 * n'écrit rien et ne l'exige pas.
 *
 * Ordre (séquentiel, au plus deux lectures après l'authentification) : session (`requireAuth`, 401 / 403 sans espace
 * actif) → id UUID (404, rien en base) → quota `geo:rl:couverture` (6 / min / compte, partagé avec la couverture,
 * 429) → sources visibles de l'espace (`getOrgSourceIds(…, { vueEspace: true })`) → RPC. L'ESPACE est celui de la
 * session, jamais un paramètre du client ; un id d'un autre espace répond 404 `zone_introuvable` (la RPC ne révèle pas
 * qu'elle existe ailleurs). Aucune typologie dans la zone : 200 avec `motif: 'aucun_poi_type'`.
 *
 * Mesuré (sql/298) : CIRFA Bretagne 2,7 ms / 1 005 accès ; zone composite de 13 001 km² 7,4 ms / 1 602 accès.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { requireAuth } from '@/lib/api/middleware';
import { MESSAGES_REFUS_COUVERTURE, quotaCouverture } from '@/lib/zones/couverture';
import { espaceDeZone, idDeZone } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';

const ECHEC = 'Lecture des typologies impossible.';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const id = idDeZone((await params).id);
  if (id instanceof NextResponse) return id;

  const refusQuota = await quotaCouverture(s.espace.userId);
  if (refusQuota) return refusQuota;

  const sources = (await getOrgSourceIds(
    { userId: s.espace.userId, orgId: s.espace.orgId, role: s.espace.role }, { vueEspace: true },
  )) ?? [];

  const { data, error } = await createAdminClient().rpc('typologies_de_zone', {
    p_zone: id, p_org: s.espace.orgId, p_sources: sources,
  });
  if (error) {
    console.error('[zones/typologies]', error.code, error.message);
    return NextResponse.json({ error: ECHEC }, { status: 500 });
  }
  const o = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (o?.refus === 'zone_introuvable') {
    return NextResponse.json({ error: MESSAGES_REFUS_COUVERTURE.zone_introuvable, refus: 'zone_introuvable' }, { status: 404 });
  }
  if (!o || !Array.isArray(o.pois) || !Array.isArray(o.modeles)) {
    console.error('[zones/typologies] réponse hors contrat', data);
    return NextResponse.json({ error: ECHEC }, { status: 500 });
  }
  return NextResponse.json(o, { headers: { 'Cache-Control': 'no-store' } });
}
