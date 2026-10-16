/**
 * POST /api/zones/apercu — la forme d'une recette, SANS l'écrire (étape ③, spec carte-en-parcours § 16).
 *
 * Corps : `{ recette, geometrie? }` — la géométrie n'est lue que pour une recette figée (dessin, import, isochrone,
 * capture) ; une recette recalculable l'ignore, le serveur la calcule. Réponse : `{ geometry, surface_km2, compte,
 * part_retenue, population }`, ou `{ error, refus? }` (400 · 401 · 403 · 404 · 409 · 422 · 429 · 500).
 *
 * Quota unique des routes de zone (`limiteurZones`, 12 / min / compte, compteur en base `consommer_quota`),
 * consommé AVANT toute lecture : `lib/zones/session-zones.ts`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { executerDansEspace, preparerRecette, reponseRefus } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Corps = z.object({ recette: z.unknown(), geometrie: z.unknown().optional() }).strict();

export async function POST(req: NextRequest) {
  const p = await preparerRecette(await requireAuth(req), req, Corps);
  if (!p.ok) return p.reponse;

  const r = await executerDansEspace(createAdminClient(), p.espace, p.recette, p.corps.geometrie);
  if (!r.ok) return reponseRefus(r);
  return NextResponse.json({
    geometry: r.geometry, surface_km2: r.surface_km2, compte: r.compte, part_retenue: r.part_retenue, population: r.population,
  });
}
