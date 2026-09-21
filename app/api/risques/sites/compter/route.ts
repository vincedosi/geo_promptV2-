/**
 * @file app/api/risques/sites/compter/route.ts
 *
 * Combien de sites à risque les filtres retiennent, et sur combien au total.
 *
 * ── POURQUOI « SUR COMBIEN » EST AUSSI IMPORTANT QUE « COMBIEN » ─────────
 *
 * « 421 sites » ne dit rien tout seul. « 421 sur 1 259 » dit qu'on regarde un
 * tiers du parc, et qu'un filtre a écarté le reste. C'est le seul moyen de
 * s'apercevoir qu'on a laissé coché un filtre oublié — et l'écran de risque
 * porte quatre familles de filtres qui se combinent.
 *
 * ── DEUX APPELS À LA MÊME FONCTION, ET C'EST VOULU ──────────────────────
 *
 * Le dénominateur est le MÊME calcul, sans filtre. Le dériver autrement — un
 * `count(*)` écrit ici, une constante, un chiffre du document d'architecture —
 * donnerait deux définitions de « un site à risque » qui divergeraient au
 * premier correctif sur le prédicat (l'état d'activité, les coordonnées
 * nulles, les régimes retenus). `compter_sites_rayon` porte ce prédicat une
 * fois ; on l'appelle deux fois.
 *
 * Le coût le permet : **1,4 ms** mesuré, l'index sur
 * `poi_france(categorie, sous_categorie)` faisant tout le travail.
 *
 * ── LE PÉRIMÈTRE FILTRE LES SITES, PAS LES HABITANTS ────────────────────
 *
 * ⚠ Un site dont la zone déborde du département apporte sa population au
 * voisin sans y compter comme site. Ce compte-ci répond donc à « combien de
 * sites sont IMPLANTÉS ici », jamais à « combien de sites exposent ce
 * territoire ». Les deux sont légitimes et différents.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson, nullableArg } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { liste } from '@/lib/api/parametres-requete';

export const dynamic = 'force-dynamic';

/*
 * Plus large que les quotas de calcul voisins (6 à 30/min) parce que cette
 * route ne calcule rien : deux lectures d'index. Le plafond est là pour
 * empêcher une boucle, pas pour protéger un budget d'I/O.
 */
const limiteur = createRateLimiter({
  max: 60,
  window: '60 s',
  prefix: 'geo:rl:risque-sites',
});

const ParamsSchema = z.object({
  gravites: z.string().max(200).optional(),
  natures: z.string().max(600).optional(),
  perim_niveau: z.enum(['departement', 'region']).optional(),
  perim_codes: z.string().max(200).optional(),
});

interface Compte {
  n_sites: number;
  par_nature: Record<string, number>;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = ParamsSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
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

  const perimNiveau = p.perim_codes ? (p.perim_niveau ?? 'departement') : null;
  const perimCodes = liste(p.perim_codes);

  /*
   * ⚠ En SÉQUENCE et non en `Promise.all`. Deux appels ne menacent aucun
   * budget — mais la règle du projet est de ne jamais ouvrir un parallélisme
   * « parce qu'on peut », et deux lectures d'index à 1,4 ms ne gagnent rien à
   * être simultanées.
   */
  const retenus = await supabase.rpc('compter_sites_rayon', {
    p_gravites: nullableArg(liste(p.gravites)),
    p_natures: nullableArg(liste(p.natures)),
    p_perim_niveau: nullableArg(perimNiveau),
    p_perim_codes: nullableArg(perimCodes),
  });
  if (retenus.error) {
    console.error('[risques/sites/compter] retenus :', retenus.error.message);
    return NextResponse.json({ error: 'Comptage des sites indisponible.' }, { status: 500 });
  }

  /*
   * Le total porte le MÊME périmètre mais AUCUN filtre de risque : « 421 sur
   * 1 259 » se lit comme « les filtres écartent les deux tiers », pas comme
   * « ce département ne pèse rien dans la France ». Rapporter à la France
   * entière depuis un département ferait la seconde lecture.
   */
  const total = await supabase.rpc('compter_sites_rayon', {
    // `null` explicite : la RPC le lit « aucun filtre », là où un tableau
    // vide voudrait dire « aucune gravité retenue », donc zéro site.
    p_gravites: nullableArg(null) as never,
    p_natures: nullableArg(null) as never,
    p_perim_niveau: nullableArg(perimNiveau),
    p_perim_codes: nullableArg(perimCodes),
  });
  if (total.error) {
    console.error('[risques/sites/compter] total :', total.error.message);
    return NextResponse.json({ error: 'Comptage des sites indisponible.' }, { status: 500 });
  }

  const r = rpcJson<Compte>(retenus.data);
  const t = rpcJson<Compte>(total.data);

  return NextResponse.json({
    retenus: r?.n_sites ?? 0,
    total: t?.n_sites ?? 0,
    // La ventilation sert le panneau « Sites » ; elle ne coûte rien de plus,
    // la RPC la rendant déjà.
    par_nature: r?.par_nature ?? {},
  });
}
