/**
 * POST /api/custom-geo/source/intersection — ce que 2 à 20 zones ont en commun.
 *
 * Tâche 14 (2026-09-13). Troisième opération booléenne de la famille
 * `custom-geo/source/*`, après l'union (`composite`, préexistante) et avec la
 * soustraction (`difference`, écrite en même temps). Le client sauvegarde
 * ensuite via `/api/custom-geo/save` (`source_type: 'intersection'`).
 *
 * **L'intersection porte sur la PREMIÈRE zone et l'union de toutes les
 * autres**, pas sur une réduction deux à deux successive. Les deux donnent le
 * même résultat sur deux zones, et divergent au-delà : `A ∩ B ∩ C` (réduction)
 * ne garde que ce qui est dans les trois, là où `A ∩ (B ∪ C)` garde ce qui est
 * dans A et dans au moins une des deux autres. C'est la seconde qui répond à
 * la question du média planner — « ma zone de base, restreinte à ce que
 * couvrent ces zones-là ».
 *
 * **Une intersection vide répond 409, elle ne crée rien.** Sans cela, une zone
 * à zéro code postal serait enregistrée en silence, puis poussée telle quelle
 * vers un DSP — une campagne qui ne diffuse nulle part, sans qu'aucune erreur
 * ne l'ait jamais dit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkZoneAccess } from '@/lib/campaigns/access';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireCorps } from '@/lib/api/valider-corps';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Quota, ajoute apres relecture (2026-09-13). Mesure du cout unitaire :
 * `get_admin_filter_geometry` sur 2 000 codes postaux lit 540 blocs DISQUE
 * par appel, `zone_dessin` sur un trace de 5 000 sommets prend 1,5 s, et
 * `zone_rayon` a 100 km 355 ms. Sans plafond, une boucle sur l'une de ces
 * routes est une porte ouverte sur le budget I/O Nano — la famille exacte
 * de l'incident du 28/03. Compteur PARTAGE en base (`consommer_quota`,
 * sql/135), jamais une Map locale qui ne limiterait rien sur Vercel.
 */
const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:zone-intersection' });

const CorpsSchema = z.object({
  zone_ids: z.array(z.string().uuid()).min(2).max(20),
});

interface ResultatBooleen {
  vide: boolean;
  geometry: { type: string; coordinates: unknown } | null;
  surface_km2: number;
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { zone_ids } = corps.valeur;

  // Une même zone deux fois rendrait une intersection avec elle-même, donc la
  // zone entière — un résultat qui a l'air d'un calcul et n'en est pas un.
  if (new Set(zone_ids).size !== zone_ids.length) {
    return NextResponse.json({ error: 'zone_dupliquee' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Chaque zone doit être accessible à l'org active. Par lots de 3 — plafond de
  // requêtes Supabase simultanées (CLAUDE.md) — et non un Promise.all sur les
  // 20 zones autorisées. Repris tel quel de `source/composite`.
  for (let i = 0; i < zone_ids.length; i += 3) {
    const lot = zone_ids.slice(i, i + 3);
    const acces = await Promise.all(lot.map((id) => checkZoneAccess(supabase, profile, id)));
    if (acces.some((a) => a !== 'ok')) {
      return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });
    }
  }

  const { data, error } = await supabase.rpc('zone_intersection', { p_zone_ids: zone_ids });
  if (error) {
    console.error('[source/intersection]', error.message);
    return NextResponse.json({ error: 'intersection_failed' }, { status: 400 });
  }

  const resultat = rpcJson<ResultatBooleen>(data);
  if (!resultat || resultat.vide || !resultat.geometry) {
    return NextResponse.json(
      { error: 'intersection_vide', message: 'Ces zones n’ont aucune surface en commun.' },
      { status: 409 },
    );
  }

  return NextResponse.json({
    geometry: resultat.geometry,
    surface_km2: resultat.surface_km2,
    n_zones: zone_ids.length,
  });
}
