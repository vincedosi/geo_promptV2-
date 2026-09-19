/**
 * POST /api/custom-geo/source/difference — une zone, moins d'autres.
 *
 * Tâche 14 (2026-09-13). Route sœur de `source/intersection` et de
 * `source/composite` (union). Le client sauvegarde ensuite via
 * `/api/custom-geo/save` (`source_type: 'difference'`).
 *
 * **L'opération n'est pas symétrique**, contrairement aux deux autres : elle
 * distingue une zone de BASE des zones RETIRÉES. Le corps le reflète
 * (`zone_base` et `zones_retirees` sont deux champs, pas une liste), pour qu'un
 * client ne puisse pas se tromper d'ordre en passant un simple tableau — « A
 * moins B » et « B moins A » ne donnent pas la même chose, et rien dans le
 * résultat ne dirait laquelle des deux on a obtenue.
 *
 * **Un résultat vide répond 409, il ne crée rien** : retirer d'une zone tout ce
 * qu'elle contenait donne une zone à zéro code postal, qui partirait ensuite au
 * DSP sans que rien ne l'ait signalé.
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
const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:zone-difference' });

const CorpsSchema = z.object({
  zone_base: z.string().uuid(),
  zones_retirees: z.array(z.string().uuid()).min(1).max(19),
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
  const { zone_base, zones_retirees } = corps.valeur;

  // Retirer la base d'elle-même rend forcément le vide : autant le dire tout
  // de suite plutôt que de faire calculer PostGIS pour répondre 409 ensuite.
  if (zones_retirees.includes(zone_base)) {
    return NextResponse.json({ error: 'base_dans_retirees' }, { status: 400 });
  }
  if (new Set(zones_retirees).size !== zones_retirees.length) {
    return NextResponse.json({ error: 'zone_dupliquee' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const toutes = [zone_base, ...zones_retirees];
  for (let i = 0; i < toutes.length; i += 3) {
    const lot = toutes.slice(i, i + 3);
    const acces = await Promise.all(lot.map((id) => checkZoneAccess(supabase, profile, id)));
    if (acces.some((a) => a !== 'ok')) {
      return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });
    }
  }

  const { data, error } = await supabase.rpc('zone_difference', {
    p_base: zone_base,
    p_retires: zones_retirees,
  });
  if (error) {
    console.error('[source/difference]', error.message);
    return NextResponse.json({ error: 'difference_failed' }, { status: 400 });
  }

  const resultat = rpcJson<ResultatBooleen>(data);
  if (!resultat || resultat.vide || !resultat.geometry) {
    return NextResponse.json(
      { error: 'difference_vide', message: 'Il ne reste rien de la zone de base après soustraction.' },
      { status: 409 },
    );
  }

  return NextResponse.json({
    geometry: resultat.geometry,
    surface_km2: resultat.surface_km2,
    n_retirees: zones_retirees.length,
  });
}
