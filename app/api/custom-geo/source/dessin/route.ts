/**
 * POST /api/custom-geo/source/dessin — une zone depuis un tracé libre
 * (Tâche 18, 2026-09-13).
 *
 * Le client sauvegarde ensuite via `/api/custom-geo/save`
 * (`source_type: 'dessin'`).
 *
 * **La géométrie n'est jamais prise telle quelle.** Un tracé à main levée
 * croise fréquemment son propre chemin, et produit alors un « nœud papillon »
 * invalide qu'aucune opération PostGIS ultérieure n'accepterait —
 * `ST_Intersection`, `ST_Area`, la résolution des codes postaux, toutes
 * lèveraient. `zone_dessin` (sql/156) passe donc par `ST_MakeValid`, qui le
 * découpe en polygones valides : mesuré, un carré croisé de 163 km² devient
 * deux triangles de 81,62 km².
 *
 * Ce qui n'est PAS récupérable — moins de trois sommets distincts, tracé
 * entièrement hors territoire — ressort vide, et la route répond **409** au
 * lieu d'enregistrer une zone sans surface qui partirait ensuite vers un DSP.
 *
 * Deux faits sont remontés pour être AFFICHÉS, pas pour la forme :
 *   `corrige`      — le tracé a dû être réparé, la zone n'est pas exactement
 *                    celle qui a été dessinée ;
 *   `part_retenue` — le clip sur `france_borders` en a retiré une part.
 * Les découvrir sur la carte après enregistrement serait pire que les lire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Un tracé à la main ne fait pas dix mille sommets. Ce plafond borne à la fois
 * la taille du corps et le coût de `ST_MakeValid`, qui est super-linéaire sur
 * un anneau très dense.
 */
const MAX_SOMMETS = 5000;

const CorpsSchema = z.object({
  geometry: z.object({
    type: z.literal('Polygon'),
    // Un anneau de positions [lon, lat]. La validité géométrique, elle, est
    // jugée en base — Zod ne sait pas ce qu'est une auto-intersection.
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]).rest(z.number()))).min(1),
  }),
});

interface ResultatDessin {
  vide: boolean;
  geometry: { type: string; coordinates: unknown } | null;
  surface_km2: number;
  corrige: boolean;
  part_retenue: number;
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { geometry } = corps.valeur;

  const nSommets = geometry.coordinates.reduce((n, anneau) => n + anneau.length, 0);
  if (nSommets > MAX_SOMMETS) {
    return NextResponse.json(
      { error: `Tracé trop dense : ${nSommets} sommets pour un maximum de ${MAX_SOMMETS}.` },
      { status: 400 },
    );
  }
  // Un anneau de moins de quatre positions (trois sommets + la fermeture) ne
  // peut pas former de surface. Le dire ici évite un aller-retour en base.
  if (!geometry.coordinates.some((anneau) => anneau.length >= 4)) {
    return NextResponse.json(
      { error: 'dessin_trop_court', message: 'Un tracé doit comporter au moins trois sommets.' },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('zone_dessin', {
    p_geojson: toJson(geometry),
  });
  if (error) {
    console.error('[source/dessin]', error.message);
    return NextResponse.json({ error: 'dessin_failed' }, { status: 400 });
  }

  const resultat = rpcJson<ResultatDessin>(data);
  if (!resultat || resultat.vide || !resultat.geometry) {
    return NextResponse.json(
      {
        error: 'dessin_vide',
        message: 'Ce tracé ne recouvre aucun territoire français, ou n’a pas de surface exploitable.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    geometry: resultat.geometry,
    surface_km2: resultat.surface_km2,
    corrige: resultat.corrige,
    part_retenue: resultat.part_retenue,
  });
}
