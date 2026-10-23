/**
 * GET /api/analyses/couverture-rayon — la courbe de couverture par rayon autour d'un type de POI (lot 4, T12) :
 * `couverture_rayon_poi` (sql/272) sur le périmètre de ① ou sur la zone analysée (`perimetre_type=zone`). Une lecture.
 *
 * Paramètres : `categorie`, `perimetre_type`, `perimetre_code` (requis) ; `cible` (défaut `ind`), `rayon_max` (100 à
 * 10 000 m, défaut 5 000), `champ` (liste fermée EN BASE : `champ_non_admis`), `valeur` répété (≤ 8, exige `champ`),
 * `profil` (JSON `{ valeur: [anneaux] }`, ≤ 4 anneaux de 100 m à `rayon_max`, sans quoi la RPC lèverait 22023).
 *
 * Ordre : session (401 / 403) → Zod (400, rien en base) → quota `geo:rl:couverture-rayon` → sources visibles de la
 * session → RPC. L'espace et les sources viennent de la SESSION, jamais du client (patron de T6). Pas de cache : le
 * résultat dépend de trop de réglages.
 *
 * Quota 6 / min / compte, comme T6 : au pire cas admis ≈ 1,5-1,7 s et ≈ 120 000 accès par appel (mesures de T11).
 * Statuts : 422 pour un refus de la requête, 503 pour une base non construite (règle de `lib/zones/couverture.ts`).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { requireAuth } from '@/lib/api/middleware';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { messageAnomalies } from '@/lib/api/valider-corps';
import { MESSAGES_REFUS_COUVERTURE, RequeteCouvertureSchema, lireReponseCouverture } from '@/lib/zones/couverture';
import { MESSAGES_REFUS, TYPES_PERIMETRE } from '@/lib/zones/recette';
import { espaceDeZone } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const limiteur = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:couverture-rayon' });
const ECHEC = 'Calcul de la couverture par rayon impossible.';
const RAYON_MIN_M = 100;
const RAYON_MAX_M = 10_000;
/** Huit teintes de valeur au plus (`--nature-1…8`), la borne de la RPC. */
const MAX_VALEURS = 8;

/** Les refus de la RPC, dans les phrases déjà écrites pour les zones (T6, recettes) quand elles existent. */
const MESSAGES = {
  perimetre_national_refuse: MESSAGES_REFUS.perimetre_national_refuse,
  perimetre_non_admis: MESSAGES_REFUS.perimetre_non_admis,
  perimetre_inconnu: MESSAGES_REFUS.perimetre_inconnu,
  perimetre_trop_grand: MESSAGES_REFUS.perimetre_trop_grand,
  commune_ambigue: MESSAGES_REFUS.commune_ambigue,
  trop_de_poi: MESSAGES_REFUS.trop_de_poi,
  cible_inconnue: MESSAGES_REFUS_COUVERTURE.cible_inconnue,
  couverture_non_construite: MESSAGES_REFUS_COUVERTURE.couverture_non_construite,
  champ_non_admis: 'Ce champ ne se détaille pas : seule la sous-catégorie est admise.',
  trop_de_valeurs: `Plus de ${MAX_VALEURS} valeurs à détailler : retenez-en ${MAX_VALEURS} au plus, ou retirez le détail par champ.`,
  calcul_trop_lourd: 'Calcul trop lourd : réduisez le périmètre, le rayon ou retirez le détail par champ.',
} as const;
type Refus = keyof typeof MESSAGES;
const REFUS = Object.keys(MESSAGES) as Refus[];

const Profil = z.string()
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Profil d’anneaux illisible.', fatal: true });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string().min(1).max(64), z.array(z.number().int().min(RAYON_MIN_M).max(RAYON_MAX_M)).min(1).max(4, 'Quatre anneaux au plus par valeur.')));

const Requete = z.object({
  categorie: z.string().regex(/^[a-z0-9_-]{1,64}$/, 'Type de POI invalide.'),
  perimetre_type: z.enum(TYPES_PERIMETRE, { errorMap: () => ({ message: 'Type de périmètre inconnu.' }) }),
  perimetre_code: z.string().min(1).max(64),
  cible: RequeteCouvertureSchema.shape.cible,
  rayon_max: z.coerce.number().int().min(RAYON_MIN_M).max(RAYON_MAX_M).default(5000),
  champ: z.string().regex(/^[a-z_]{1,32}$/, 'Champ invalide.').optional(),
  valeur: z.array(z.string().min(1).max(64)).max(MAX_VALEURS, `${MAX_VALEURS} valeurs au plus.`),
  profil: Profil.optional(),
}).superRefine((r, ctx) => {
  if (r.valeur.length > 0 && !r.champ) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valeur'], message: 'Des valeurs exigent un champ.' });
  if (Object.values(r.profil ?? {}).some((a) => a.some((m) => m > r.rayon_max))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['profil'], message: 'Un anneau dépasse le rayon maximal.' });
  }
});

export async function GET(req: NextRequest) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const sp = req.nextUrl?.searchParams ?? new URL(req.url).searchParams;
  const p = Requete.safeParse({
    categorie: sp.get('categorie') ?? undefined,
    perimetre_type: sp.get('perimetre_type') ?? undefined,
    perimetre_code: sp.get('perimetre_code') ?? undefined,
    cible: sp.get('cible') ?? undefined,
    rayon_max: sp.get('rayon_max') ?? undefined,
    champ: sp.get('champ') ?? undefined,
    valeur: sp.getAll('valeur'),
    profil: sp.get('profil') ?? undefined,
  });
  if (!p.success) return NextResponse.json({ error: messageAnomalies(p.error) }, { status: 400 });

  const quota = await limiteur(s.espace.userId);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { userId, orgId, role } = s.espace;
  const sources = (await getOrgSourceIds({ userId, orgId, role }, { vueEspace: true })) ?? [];
  const r = p.data;
  const { data, error } = await createAdminClient().rpc('couverture_rayon_poi', {
    p_categorie: r.categorie, p_perimetre_type: r.perimetre_type, p_perimetre_code: r.perimetre_code, p_org_id: orgId,
    // Absents : omis, la RPC prend ses défauts (NULL).
    p_sources: sources, p_cible: r.cible, p_rayon_max_m: r.rayon_max, p_champ: r.champ,
    p_valeurs: r.valeur.length > 0 ? r.valeur : undefined, p_profil: r.profil,
  });
  if (error) {
    console.error('[analyses/couverture-rayon]', error.code, error.message);
    // 22023 : un argument hors contrat que Zod n'a pas vu — la requête est fausse, pas le serveur.
    if (error.code === '22023') return NextResponse.json({ error: 'Paramètres de calcul invalides.' }, { status: 400 });
    return NextResponse.json({ error: ECHEC }, { status: 500 });
  }
  const lue = lireReponseCouverture(data, REFUS);
  if (!lue) {
    console.error('[analyses/couverture-rayon] réponse hors contrat', data);
    return NextResponse.json({ error: ECHEC }, { status: 500 });
  }
  if (lue.ok) return NextResponse.json(lue.resultat);
  return NextResponse.json(
    { error: MESSAGES[lue.refus], refus: lue.refus, ...lue.details },
    { status: lue.refus === 'couverture_non_construite' ? 503 : 422 },
  );
}
