/**
 * @file app/api/risques/exposition/rayon/route.ts
 *
 * Courbe de couverture de population par rayon autour des sites à risque
 * (sql/198 pour la construction, sql/199 pour la lecture). Sert l'onglet
 * « Rayon d'influence » de l'overlay population.
 *
 * ── POURQUOI CETTE ROUTE EST RAPIDE ALORS QUE SA VOISINE NE L'EST PAS ────
 *
 * `/agregats` calcule à la demande, et paie 3 à 43 s selon le rayon et le
 * nombre de sites. Celle-ci ne calcule RIEN : elle lit une table pré-agrégée
 * au grain (département × gravité × nature × palier de 100 m).
 *
 * Ce pré-calcul n'est pas un confort. Mesuré le 2026-09-18 : entre 500 000 et
 * 1 000 000 de carreaux se trouvent à moins de 10 km d'un site Seveso, soit
 * jusqu'à 40 % de la base. Une courbe de 100 paliers calculée à la volée est
 * hors de portée, et le pré-calcul lui-même a demandé 40 bandes de traitement.
 *
 * ── CE QUE LE CLIENT DOIT SAVOIR LIRE ────────────────────────────────────
 *
 * `courbes[].cle` vaut `'*'` pour la courbe « toutes natures », sinon le
 * libellé d'une nature. **La courbe `'*'` n'est PAS la somme des autres** : un
 * carreau proche de deux natures compte dans les deux courbes — ce qui est
 * correct pour chacune et faux pour leur somme. Elle est calculée au minimum
 * par carreau, à la construction.
 *
 * `total_est_global` prévient que l'utilisateur a filtré les natures mais que
 * la courbe totale, elle, porte toujours sur TOUTES. L'écran doit le dire au
 * lieu de laisser croire à un total du sous-ensemble.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson, nullableArg } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * 30 par minute — plus généreux que les 20 de `/agregats`, parce que cette
 * route ne fait qu'une lecture indexée. Le quota reste là pour qu'un client en
 * boucle ne puisse pas marteler la base, pas pour rationner un calcul coûteux.
 * Compteur PARTAGÉ en base (`consommer_quota`, sql/135).
 */
const limiteur = createRateLimiter({
  max: 30,
  window: '60 s',
  prefix: 'geo:rl:exposition-rayon',
});

const ParamsSchema = z.object({
  cible: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  gravites: z.string().max(200).optional(),
  natures: z.string().max(2000).optional(),
  perim_niveau: z.enum(['region', 'departement']).optional(),
  perim_codes: z.string().max(600).optional(),
});

const MESSAGES: Record<string, string> = {
  cible_inconnue:
    "Cette cible n'est pas calculable. Seuls les effectifs le sont — un taux ne se prorate pas par la surface.",
};

/** 'a,b , c' → ['a','b','c'] ; chaîne vide ou absente → null (= pas de filtre). */
function liste(brut: string | undefined): string[] | null {
  if (!brut) return null;
  const v = brut.split(',').map((s) => s.trim()).filter(Boolean);
  return v.length > 0 ? v : null;
}

interface Point { r: number; p: number; i: number }
interface Courbe { cle: string; total: number; carreaux: number; points: Point[] }
interface Reponse {
  calculable: boolean;
  error?: string;
  cible: string;
  gravite: string;
  rayon_max_m: number;
  total_est_global: boolean;
  n_departements: number;
  courbes: Courbe[];
  calcule_le: string;
  n_sites?: number;
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

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const args = {
    p_cible: p.cible ?? 'ind',
    p_gravites: nullableArg(liste(p.gravites)),
    p_natures: nullableArg(liste(p.natures)),
    p_perim_niveau: nullableArg(p.perim_codes ? (p.perim_niveau ?? 'departement') : null),
    p_perim_codes: nullableArg(liste(p.perim_codes)),
  };

  /*
   * DEUX appels, jamais trois : la courbe et le compte de sites. Le budget du
   * projet est de 3 requêtes Supabase simultanées (CLAUDE.md) ; on reste sous
   * la limite et le compte de sites est un COUNT indexé, pas un calcul.
   *
   * Ils sont groupés parce qu'ils sont indépendants et que l'écran a besoin
   * des deux pour afficher un KPI complet — les séquencer ajouterait un
   * aller-retour pour rien.
   */
  const [courbe, sites] = await Promise.all([
    supabase.rpc('lire_couverture_rayon', args),
    supabase.rpc('compter_sites_rayon', {
      p_gravites: args.p_gravites,
      p_natures: args.p_natures,
      p_perim_niveau: args.p_perim_niveau,
      p_perim_codes: args.p_perim_codes,
    }),
  ]);

  if (courbe.error) {
    console.error('[risques/exposition/rayon]', courbe.error.message);
    return NextResponse.json({ error: 'Courbe indisponible.' }, { status: 500 });
  }

  const resultat = rpcJson<Reponse>(courbe.data);
  if (!resultat) {
    return NextResponse.json({ error: 'Courbe indisponible.' }, { status: 500 });
  }
  if (!resultat.calculable) {
    return NextResponse.json(
      { error: MESSAGES[resultat.error ?? ''] ?? 'Courbe impossible.' },
      { status: 400 },
    );
  }

  /*
   * La table pré-calculée peut être VIDE — elle n'existe qu'après la
   * construction (`scripts/construire_couverture_rayon.mjs`). Le dire
   * explicitement vaut mieux que de rendre une courbe plate, qui se lirait
   * « personne n'habite près d'un site à risque ».
   */
  if (resultat.courbes.length === 0) {
    return NextResponse.json(
      {
        error:
          'La couverture par rayon n’a pas encore été construite pour ce périmètre. ' +
          'Elle se calcule une fois après chaque import de sites à risque.',
        a_construire: true,
      },
      { status: 409 },
    );
  }

  const compte = rpcJson<{ n_sites: number }>(sites.data);

  return NextResponse.json(
    { ...resultat, n_sites: compte?.n_sites ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
