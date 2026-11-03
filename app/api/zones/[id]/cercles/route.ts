/**
 * GET /api/zones/[id]/cercles?cible=&rayon=&seuil=&plateforme= — une zone de l'espace actif pavée en cercles pour UNE
 * plateforme (lot 5, T8 ; plan A-8) : les cercles retenus au seuil et la perte exacte sur leur union
 * (`paver_cercles`, sql/276). Rien n'est enregistré ; D33 (sql/338) : le pavage est GARDÉ en cache par (version de la
 * zone, cible, rayon, seuil, limites de la ligne) — les simulations de maille de ⑤ (B9) pavent au rayon par défaut à
 * chaque ouverture, et un pavage refait coûte 0,3 à 1,9 s (mesuré le 03/11). Un refus ne s'y écrit jamais.
 *
 * Ordre (SÉQUENTIEL, au plus trois appels en base avant le pavage) : session (`requireAuth`, 401 / 403) → id UUID
 * (404) et paramètres Zod (400), rien en base → la règle `(plateforme, cercle)` lue dans `plateformes_geo` : couple
 * absent, maille indisponible ou rayon hors des bornes de la PLATEFORME → 400 avant tout calcul (la RPC n'a que des
 * bornes de sécurité, [1 000, 200 000] m) → `pavage_cercles_en_cache` (D33 : servi s'il est valide, SANS jeton) →
 * quota `geo:rl:conversion` (429) → `paver_cercles_cache` avec les limites de la ligne (`max_unites`,
 * `pop_min_unite`) — jamais du client (§ 16.2-3, Review Focus 5) ; il relit le cache, sinon pave et l'écrit.
 *
 * L'ESPACE est celui de la session (`espaceDeZone`), jamais un paramètre : une zone d'un autre espace rend 404.
 * Statuts des refus : 404 `zone_introuvable`, 503 `couverture_non_construite`, 422 sinon (`trop_de_cercles` porte
 * `n_cercles` et `plafond`) — messages `MESSAGES_CONVERSION` (`lib/zones/conversion.ts`).
 *
 * B10 : un refus `trop_de_cercles` porte aussi le plus petit rayon qui passe sous le plafond (`rayon_propose`, ou
 * `null` et `sans_proposition`) — `paverAvecProposition`, au plus six pavages de plus, UN À LA FOIS, dans la même
 * requête. Rien n'est appliqué : l'écran propose, l'utilisateur choisit. Tour 1 (I-1) : chaque essai prend un jeton
 * du MÊME quota, et aucun essai ne commence si le temps restant au budget `BUDGET_RECHERCHE_RAYON_MS` (40 s depuis
 * l'arrivée de la requête) ne couvre pas le coût du précédent ; tout arrêt est rendu (`interrompue` : cause, dernier
 * rayon essayé et ses cercles) et dit à l'écran.
 *
 * Quota : 6 PAVAGES / min / compte, essais de la recherche compris (un pavage n'est ni une couverture ni une zone).
 * Au pire connu d'un pavage (ARA à 40 km depuis A6, sql/311 : 5,6 s, ≈ 120 000 accès), ≈ 720 000 accès / min / compte,
 * quelle que soit la recherche. Durée d'une requête : au plus 40 s + le coût d'un essai (le dernier lancé) — un essai
 * plus cher que son prédécesseur peut déborder du budget, pas du `maxDuration` de 60 s tant qu'il reste sous 20 s.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { createQuota } from '@/lib/api/rate-limit';
import { espaceDeZone, idDeZone } from '@/lib/zones/session-zones';
import { RequeteCouvertureSchema, repondreCouverture } from '@/lib/zones/couverture';
import { MESSAGES_CONVERSION } from '@/lib/zones/conversion';
import { BUDGET_RECHERCHE_RAYON_MS, lireRegles, paverAvecProposition, pavageEnCache, refusDuChoix } from '@/lib/zones/conversion-serveur';
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
  const arrivee = Date.now();
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

  // D33 : un pavage en cache ne coûte qu'une lecture de clé primaire, et aucun jeton (comme une couverture, sql/270).
  const demande = { zoneId: id, orgId: s.espace.orgId, cible, rayon_m: rayon, seuil };
  const cache = await pavageEnCache(supabase, demande, regle);
  if (cache.error || cache.data !== null) return repondreCouverture(cache, MESSAGES_CONVERSION, 'zones/cercles cache', ECHEC);

  const refusQuota = await quotaConversion(s.espace.userId);
  if (refusQuota) return refusQuota;

  // Tour 1 (I-1) : chaque essai de la recherche du rayon proposé paie un jeton, dans le budget de temps de la requête.
  const garde = {
    reste_ms: () => BUDGET_RECHERCHE_RAYON_MS - (Date.now() - arrivee),
    consommer: async () => (await quotaConversion(s.espace.userId)) === null,
  };
  const pavage = await paverAvecProposition(supabase, demande, regle, garde, 'paver_cercles_cache');
  return repondreCouverture(pavage, MESSAGES_CONVERSION, 'zones/cercles', ECHEC, 'Rayon ou seuil hors des bornes du calcul.');
}
