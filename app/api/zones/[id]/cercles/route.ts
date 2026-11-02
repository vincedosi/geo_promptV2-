/**
 * GET /api/zones/[id]/cercles?cible=&rayon=&seuil=&plateforme= — une zone de l'espace actif pavée en cercles pour UNE
 * plateforme (lot 5, T8 ; plan A-8) : les cercles retenus au seuil et la perte exacte sur leur union
 * (`paver_cercles`, sql/276). Une lecture : rien n'est enregistré, et rien n'est mis en cache — le résultat dépend du
 * rayon et du seuil, que l'écran règle (la réglette de rayon ne requête qu'au relâchement, P-h).
 *
 * Ordre (SÉQUENTIEL) : session (`requireAuth`, 401 / 403) → id UUID (404) et paramètres Zod (400), rien en base →
 * quota `geo:rl:conversion` (429) → la règle `(plateforme, cercle)` lue dans `plateformes_geo` : couple absent, maille
 * indisponible ou rayon hors des bornes de la PLATEFORME → 400 avant tout calcul (la RPC n'a que des bornes de
 * sécurité, [1 000, 200 000] m) → `paver_cercles` avec les limites de la ligne (`max_unites`, `pop_min_unite`) —
 * jamais du client (§ 16.2-3, Review Focus 5).
 *
 * L'ESPACE est celui de la session (`espaceDeZone`), jamais un paramètre : une zone d'un autre espace rend 404.
 * Statuts des refus : 404 `zone_introuvable`, 503 `couverture_non_construite`, 422 sinon (`trop_de_cercles` porte
 * `n_cercles` et `plafond`) — messages `MESSAGES_CONVERSION` (`lib/zones/conversion.ts`).
 *
 * B10 : un refus `trop_de_cercles` porte aussi le plus petit rayon qui passe sous le plafond (`rayon_propose`, ou
 * `null` et `sans_proposition`) — `paverAvecProposition`, au plus six pavages de plus, UN À LA FOIS, dans la même
 * requête (≈ 40 s au pire mesuré depuis A6, sous `maxDuration`). Rien n'est appliqué : l'écran propose, l'utilisateur choisit.
 *
 * Quota : 6 / min / compte, à lui seul (un pavage n'est ni une couverture ni une zone). Au pire mesuré (ARA à 40 km,
 * 1,76 s / 119 500 accès, sql/276), ≈ 720 000 accès / min / compte.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { createQuota } from '@/lib/api/rate-limit';
import { espaceDeZone, idDeZone } from '@/lib/zones/session-zones';
import { RequeteCouvertureSchema, repondreCouverture } from '@/lib/zones/couverture';
import { MESSAGES_CONVERSION } from '@/lib/zones/conversion';
import { lireRegles, paverAvecProposition, refusDuChoix } from '@/lib/zones/conversion-serveur';
import { PLATEFORMES } from '@/lib/zones/plateformes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const quotaConversion = createQuota({ max: 6, window: '60 s', prefix: 'geo:rl:conversion' });

const ECHEC = 'Pavage en cercles impossible.';

/** `null` (paramètre absent) → `undefined`, pour que Zod dise « requis » et non « NaN ». */
const nombre = (message: string) => z.preprocess((v) => (v === null || v === '' ? undefined : Number(v)), z.number({ message }));

const RequeteCerclesSchema = z.object({
  cible: RequeteCouvertureSchema.shape.cible,
  rayon: nombre('Rayon requis, en mètres.').pipe(z.number().int('Rayon entier, en mètres.').positive('Rayon positif, en mètres.')),
  seuil: nombre('Seuil requis, en pourcentage.').pipe(z.number().min(0, 'Seuil entre 0 et 100 %.').max(100, 'Seuil entre 0 et 100 %.')),
  plateforme: z.enum(PLATEFORMES, { errorMap: () => ({ message: `Plateforme inconnue : ${PLATEFORMES.join(', ')}.` }) }),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const id = idDeZone((await params).id);
  if (id instanceof NextResponse) return id;
  const sp = req.nextUrl?.searchParams ?? new URL(req.url).searchParams;
  const p = RequeteCerclesSchema.safeParse({
    cible: sp.get('cible') ?? undefined,
    rayon: sp.get('rayon'),
    seuil: sp.get('seuil'),
    plateforme: sp.get('plateforme') ?? undefined,
  });
  if (!p.success) {
    return NextResponse.json({ error: p.error.issues[0]?.message ?? 'Paramètres invalides.' }, { status: 400 });
  }
  const { cible, rayon, seuil, plateforme } = p.data;

  const refusQuota = await quotaConversion(s.espace.userId);
  if (refusQuota) return refusQuota;

  const supabase = createAdminClient();
  let regle;
  try {
    regle = (await lireRegles(supabase, [plateforme])).find((l) => l.plateforme === plateforme && l.maille === 'cercle');
  } catch (e) {
    console.error('[zones/cercles] règles :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: ECHEC }, { status: 500 });
  }
  const refus = refusDuChoix({ plateforme, maille: 'cercle', rayon_m: rayon }, regle);
  if (refus || !regle) return NextResponse.json({ error: refus }, { status: 400 });

  const pavage = await paverAvecProposition(supabase, { zoneId: id, orgId: s.espace.orgId, cible, rayon_m: rayon, seuil }, regle);
  return repondreCouverture(pavage, MESSAGES_CONVERSION, 'zones/cercles', ECHEC, 'Rayon ou seuil hors des bornes du calcul.');
}
