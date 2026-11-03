/**
 * POST /api/zones — écrire une zone à recette dans l'espace ACTIF (spec carte-en-parcours § 16, arbitrage L3-4).
 *
 * Corps : `{ nom (1-200), recette, geometrie? }`. La recette est RÉ-EXÉCUTÉE ici : une géométrie cliente n'est lue
 * que pour une recette figée. Puis `creer_zone_recette` (sql/253 — elle peut REFUSER une recette qui cite une zone
 * hors de l'espace : 422) et `resolve_custom_geo_zone_codes` (sql/252 ; compteurs de « Mes zones », elle n'achète
 * rien) ; une résolution en échec rend 207 — la zone existe.
 *
 * Réponse : `{ zone_id, count_cp, count_iris, surface_km2 }` | 207 `{ zone_id, warning: 'codes_non_resolus', message }`
 * | `{ error, refus? }`. Quota unique des routes de zone (`lib/zones/session-zones.ts`).
 *
 * N'est PAS `/api/custom-geo/save`, que React gelé garde (arbitrage A-5) : les deux écrivent `custom_geo_zones`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { toJson } from '@/lib/supabase/rpc-json';
import { MESSAGES_REFUS } from '@/lib/zones/recette';
import { executerDansEspace, lireCreation, preparerRecette, recetteAEcrire, repondreResolue, reponseRefus } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Corps = z.object({ nom: z.string().trim().min(1).max(200), recette: z.unknown(), geometrie: z.unknown().optional() }).strict();

export async function POST(req: NextRequest) {
  const p = await preparerRecette(await requireAuth(req), req, Corps);
  if (!p.ok) return p.reponse;

  const supabase = createAdminClient();
  const r = await executerDansEspace(supabase, p.espace, p.recette, p.corps.geometrie);
  if (!r.ok) return reponseRefus(r);

  const cree = await supabase.rpc('creer_zone_recette', {
    p_nom: p.corps.nom, p_org_id: p.espace.orgId, p_cree_par: p.espace.userId,
    // B15 : les unités constitutives établies par le serveur (`recetteAEcrire`), jamais celles du client.
    p_recette: toJson(recetteAEcrire(p.recette, r)), p_geometry_geojson: JSON.stringify(r.geometry),
  });
  const issue = cree.error ? null : lireCreation(cree.data);
  if (issue && 'refus' in issue) return reponseRefus({ statut: 422, refus: issue.refus, message: MESSAGES_REFUS[issue.refus] });
  if (!issue) {
    console.error('[zones] creer_zone_recette :', cree.error?.message ?? 'réponse hors contrat', cree.error ? '' : cree.data);
    return NextResponse.json({ error: 'Enregistrement de la zone impossible.' }, { status: 500 });
  }
  return repondreResolue(supabase, issue.id, p.espace.userId, r.surface_km2, 'creation',
    // C21 : une zone « nationale moins zones locales » se compte comme une zone pays, sans résolution géométrique.
    p.recette.type === 'pays' || r.base_pays !== undefined);
}
