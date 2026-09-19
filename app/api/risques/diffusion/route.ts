/**
 * @file app/api/risques/diffusion/route.ts
 *
 * GET — confronte la diffusion d'une campagne aux classes de risque du profil
 * courant (sql/207).
 *
 * ── LA QUESTION QU'ELLE POSE ─────────────────────────────────────────────
 *
 * « Cette campagne presse-t-elle plus, ou moins, les zones à risque que leur
 * poids démographique ne le justifierait ? » C'est la finalité déclarée du
 * module : un custom bidding différencié entre seuil haut et seuil bas.
 *
 * La réponse tient dans l'INDICE DE PRESSION : part des impressions rapportée
 * à la part de population, ×100. 100 = la classe reçoit exactement sa part ;
 * 150 = elle en reçoit la moitié en plus.
 *
 * ── CE QUE LE CLIENT DOIT SAVOIR LIRE ────────────────────────────────────
 *
 * Les impressions sont VENTILÉES, pas mesurées : une campagne est achetée au
 * code postal, le risque se mesure au carreau. La ventilation se fait au
 * prorata de population, avec pour dénominateur la population TOTALE du code
 * postal — pas sa seule part exposée. Sans cela, un code postal comptant un
 * habitant exposé sur cinquante mille enverrait toutes ses impressions dans la
 * classe à risque.
 *
 * C'est une hypothèse d'uniformité à l'intérieur du code postal : fausse au
 * détail, raisonnable en agrégat, et de la même famille que le prorata de
 * surface déjà employé pour la population exposée (`lib/risques/methode.ts`).
 * L'écran doit le dire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { rpcJson, nullableArg, toJson } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { profilDepuisCode } from '@/lib/risques/code-profil';

export const dynamic = 'force-dynamic';

const limiteur = createRateLimiter({
  max: 30,
  window: '60 s',
  prefix: 'geo:rl:risque-diffusion',
});

const ParamsSchema = z.object({
  campagne: z.string().uuid(),
  profil: z.string().min(3).max(128),
  cible: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  maille: z.enum(['departement', 'commune']).optional(),
  parent: z.string().regex(/^(2A|2B|\d{2,3})$/).optional(),
});

const MESSAGES: Record<string, string> = {
  cible_inconnue:
    "Cette cible n'est pas calculable. Seuls les effectifs le sont — un taux ne se prorate pas.",
  maille_non_portee:
    'Cette maille n’est pas disponible pour la diffusion. Le département et la commune le sont.',
  denominateur_absent:
    'La population par code postal n’a pas encore été calculée. Sans dénominateur, '
    + 'aucune part ne peut être établie.',
};

interface ClasseDiffusion {
  classe: string;
  population: number;
  impressions: number;
  depense: number;
  /** Part des impressions / part de population × 100. `null` si incalculable. */
  indice: number | null;
}

interface Reponse {
  calculable: boolean;
  error?: string;
  campagne: string;
  /** `dsp_campaigns.is_demo` — l'ecran doit afficher le badge correspondant. */
  est_demo: boolean;
  cible: string;
  maille: string;
  parent: string | null;
  impressions_totales: number;
  impressions_en_zone: number;
  population_touchee: number;
  classes: ClasseDiffusion[];
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = ParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Paramètres invalides.', detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  const profil = profilDepuisCode(p.profil);
  if (!profil) {
    return NextResponse.json(
      {
        error:
          'Profil de rayons illisible ou hors bornes. Les rayons vont de 100 m à 10 km, '
          + 'quatre anneaux au plus par niveau.',
      },
      { status: 400 },
    );
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();

  /*
   * Le scoping par organisation passe par le MÊME garde que les autres routes
   * de campagne. Le réécrire ici ferait diverger l'autorisation d'un écran à
   * l'autre — et les policies RLS étant dormantes (ARCHITECTURE.md), ce garde
   * est la seule barrière réelle.
   */
  const acces = await checkCampaignAccess(supabase, profile, p.campagne);
  if (acces === 'not_found') {
    return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  }
  if (acces !== 'ok') {
    return NextResponse.json({ error: 'Accès refusé à cette campagne.' }, { status: 403 });
  }

  const { data, error } = await supabase.rpc('diffusion_par_classe', {
    p_campagne: p.campagne,
    p_profil: toJson(profil),
    p_cible: p.cible ?? 'ind',
    p_maille: p.maille ?? 'departement',
    p_parent: nullableArg(p.parent ?? null),
    p_limite: 200,
  });

  if (error) {
    console.error('[risques/diffusion]', error.message);
    return NextResponse.json({ error: 'Diffusion indisponible.' }, { status: 500 });
  }

  const resultat = rpcJson<Reponse>(data);
  if (!resultat) {
    return NextResponse.json({ error: 'Diffusion indisponible.' }, { status: 500 });
  }
  if (!resultat.calculable) {
    return NextResponse.json(
      { error: MESSAGES[resultat.error ?? ''] ?? 'Calcul impossible.' },
      { status: resultat.error === 'denominateur_absent' ? 409 : 400 },
    );
  }

  /*
   * Une campagne sans aucune impression n'est pas une erreur : elle peut être
   * en cours d'armement. Mais rendre des indices calculés sur zéro donnerait
   * des `null` partout sans explication — le dire est plus utile.
   */
  if (resultat.impressions_totales === 0) {
    return NextResponse.json(
      {
        error:
          'Cette campagne n’a encore aucune impression au code postal. '
          + 'La pression ne peut pas être comparée à l’exposition.',
        sans_donnees: true,
      },
      { status: 404 },
    );
  }

  return NextResponse.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
}
