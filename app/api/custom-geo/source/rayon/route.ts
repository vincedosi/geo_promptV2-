/**
 * POST /api/custom-geo/source/rayon — une zone circulaire autour d'un point
 * (Tâche 17, 2026-09-13).
 *
 * Le client sauvegarde ensuite via `/api/custom-geo/save`
 * (`source_type: 'rayon'`).
 *
 * **À ne pas confondre avec `rayon_poi`**, qui est un rayon de RECHERCHE de
 * POI et reste où il est : celui-ci fabrique une géométrie de zone.
 *
 * ── Deux choses que la réponse dit, et qui ne sont pas décoratives ────────
 *
 * `part_retenue` : le cercle est clippé sur `france_borders`, et un rayon posé
 * sur la côte perd une grande part de sa surface dans la mer. Mesuré :
 * Marseille 20 km ne retient que **60,5 %** du cercle, Saint-Denis de la
 * Réunion **43,9 %**. Sans ce chiffre, le média planner croit acheter 1 257 km²
 * et en achète 755.
 *
 * `vide` : un centre posé en pleine mer donne un cercle entièrement clippé.
 * La route répond alors 409 plutôt que d'enregistrer une zone sans surface,
 * qui partirait ensuite vers un DSP.
 *
 * Et `france_borders` couvre les DROM (−61,8° à 55,8° de longitude) : le clip
 * ne les perd pas, ce qu'il fallait vérifier avant de l'appliquer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireCorps } from '@/lib/api/valider-corps';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { RAYON_POINT_MIN_M } from '@/lib/zones/recette';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Plafond de rayon. Au-delà de 100 km, la zone couvre une région entière et la
 * résolution de ses codes postaux devient un scan — exactement le genre de
 * requête que le budget I/O Nano interdit (CLAUDE.md).
 */
const RAYON_MAX_M = 100_000;
/**
 * B8 (ARB-5) : le minimum d'une recette « rayon autour d'un point » (250 m, `RAYON_POINT_MIN_M`) — sous ce rayon le
 * disque est plus petit qu'un carreau de population. Il était de 100 m ; les deux curseurs (React et Angular) partent
 * de 500 m, aucun ne l'atteignait.
 */
const RAYON_MIN_M = RAYON_POINT_MIN_M;

/**
 * Quota, ajoute apres relecture (2026-09-13). Mesure du cout unitaire :
 * `get_admin_filter_geometry` sur 2 000 codes postaux lit 540 blocs DISQUE
 * par appel, `zone_dessin` sur un trace de 5 000 sommets prend 1,5 s, et
 * `zone_rayon` a 100 km 355 ms. Sans plafond, une boucle sur l'une de ces
 * routes est une porte ouverte sur le budget I/O Nano — la famille exacte
 * de l'incident du 28/03. Compteur PARTAGE en base (`consommer_quota`,
 * sql/135), jamais une Map locale qui ne limiterait rien sur Vercel.
 */
const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:zone-rayon' });

const CorpsSchema = z.object({
  // Bornes du monde, pas de la France : le clip sur `france_borders` fait le
  // tri, et refuser ici une coordonnée DROM serait une erreur.
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  rayon_m: z.number().int().min(RAYON_MIN_M).max(RAYON_MAX_M),
});

interface ResultatRayon {
  vide: boolean;
  geometry: { type: string; coordinates: unknown } | null;
  surface_km2: number;
  part_retenue: number;
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { lon, lat, rayon_m } = corps.valeur;

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('zone_rayon', {
    p_lon: lon, p_lat: lat, p_rayon_m: rayon_m,
  });
  if (error) {
    console.error('[source/rayon]', error.message);
    return NextResponse.json({ error: 'rayon_failed' }, { status: 400 });
  }

  const resultat = rpcJson<ResultatRayon>(data);
  if (!resultat || resultat.vide || !resultat.geometry) {
    return NextResponse.json(
      {
        error: 'rayon_vide',
        message: 'Ce rayon ne recouvre aucun territoire français — le centre est-il en mer ?',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    geometry: resultat.geometry,
    surface_km2: resultat.surface_km2,
    // Remonté pour être AFFICHÉ avant l'enregistrement, pas pour la forme.
    part_retenue: resultat.part_retenue,
    rayon_m,
    centre: { lon, lat },
  });
}
