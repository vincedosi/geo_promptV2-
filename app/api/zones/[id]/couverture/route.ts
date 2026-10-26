/**
 * GET /api/zones/[id]/couverture?cible=&decoupage= — la couverture d'une zone de l'espace actif (lot 4, T6) : la
 * population d'une cible dans la zone TELLE QUELLE, ou découpée par CP / par IRIS avec la part de chaque territoire
 * (`couverture_geometrie`, sql/269). Une lecture : rien n'est converti, aucune zone n'est créée.
 *
 * Ordre (tout est SÉQUENTIEL, au plus trois appels en base après l'authentification) :
 *   session (`requireAuth`, 401 / 403 sans espace actif) → id UUID (404) et paramètres Zod (400), rien en base →
 *   `couverture_zone_en_cache` (sql/270 : la validité — espace, `updated_at` de la zone, date de construction de la
 *   base, certificat — se juge EN SQL ; un id d'un autre espace n'y lit rien) → si rien en cache, quota
 *   `geo:rl:couverture` → `couverture_zone` (relit le cache, sinon calcule et écrit le cache).
 *
 * L'ESPACE est celui de la session (`profile.organization_id`, `espaceDeZone`), JAMAIS un paramètre ni un en-tête du
 * client : c'est lui seul qui part en `p_org_id` (Review Focus 1). Les RLS sont dormantes (service_role) : le contrôle
 * d'espace est dans les deux RPC, sur ce `p_org_id`.
 *
 * Quota (A-16, correction R-4) : 6 / min / compte (`quotaCouverture`), partagé avec les contours de communes de ⑤
 * (`/api/zones/communes/contours`), consommé APRÈS la lecture du
 * cache — un chiffrage en cache ne coûte pas de jeton. Au pire (ARA par IRIS ≈ 68 000 accès mesurés en T5 ; 347 000 dans le plan), ≈ 2,1 M accès / min /
 * compte. Statuts des refus : `lib/zones/couverture.ts`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { espaceDeZone, idDeZone } from '@/lib/zones/session-zones';
import { MESSAGES_REFUS_COUVERTURE, RequeteCouvertureSchema, quotaCouverture, repondreCouverture } from '@/lib/zones/couverture';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ECHEC = 'Calcul de la couverture impossible.';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const id = idDeZone((await params).id);
  if (id instanceof NextResponse) return id;
  const sp = req.nextUrl?.searchParams ?? new URL(req.url).searchParams;
  const p = RequeteCouvertureSchema.safeParse({
    cible: sp.get('cible') ?? undefined,
    decoupage: sp.get('decoupage') ?? undefined,
  });
  if (!p.success) {
    return NextResponse.json({ error: p.error.issues[0]?.message ?? 'Paramètres invalides.' }, { status: 400 });
  }

  const args = { p_zone_id: id, p_org_id: s.espace.orgId, p_cible: p.data.cible, p_decoupage: p.data.decoupage };
  const supabase = createAdminClient();

  const cache = await supabase.rpc('couverture_zone_en_cache', args);
  if (cache.error || cache.data !== null) return repondreCouverture(cache, MESSAGES_REFUS_COUVERTURE, 'zones/couverture cache', ECHEC);

  const refusQuota = await quotaCouverture(s.espace.userId);
  if (refusQuota) return refusQuota;

  const calcul = await supabase.rpc('couverture_zone', args);
  return repondreCouverture(calcul, MESSAGES_REFUS_COUVERTURE, 'zones/couverture calcul', ECHEC);
}
