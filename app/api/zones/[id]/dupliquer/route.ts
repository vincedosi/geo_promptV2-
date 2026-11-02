/**
 * POST /api/zones/[id]/dupliquer — une NOUVELLE zone à partir d'une zone de l'espace actif (③ finitions, T2 ; V-4,
 * Q-3, arbitrage A-5). Corps : `{ nom (1-200) }`, strict — aucune géométrie ne voyage vers cette route.
 *
 * Ordre : espace → id (404 sans lecture s'il est illisible) → corps (400) → quota PARTAGÉ des routes de zone
 * (`geo:rl:zones`, 429) → lecture de la zone bornée à l'espace (404 si absente OU d'un autre espace) → selon sa
 * recette (`modeDuplication`, `lib/zones/dupliquer.ts`) :
 * - recalculable → exécutée À NEUF (`executerDansEspace`, sans géométrie cliente), écrite par `creer_zone_recette`
 *   (sql/253) avec la MÊME recette, puis `source_metadata.duplique_de` posé sur la nouvelle zone. C'est « Recalculer
 *   dans une nouvelle zone » : permis même quand la source est citée par un plan (A-2 n'interdit que de la modifier) ;
 * - figée, NULL ou illisible → `dupliquer_zone` (sql/294) copie forme, recette et sous-zones EN BASE.
 * Puis `resolve_custom_geo_zone_codes` comme à la création (200, ou 207 « Zone créée ; ses codes postaux… »).
 *
 * La zone source n'est JAMAIS écrite. La route n'est PAS idempotente (chaque appel crée une zone) : l'écran désactive
 * son bouton dès le premier clic, comme pour `POST /api/zones`.
 *
 * Réponse : `{ zone_id, count_cp, count_iris, surface_km2 }` | 207 `{ zone_id, warning, message }` | `{ error, refus? }`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { toJson } from '@/lib/supabase/rpc-json';
import { lireCopie, modeDuplication } from '@/lib/zones/dupliquer';
import { MESSAGES_REFUS } from '@/lib/zones/recette';
import { estRecettePays } from '@/lib/zones/couverture';
import {
  espaceDeZone, executerDansEspace, idDeZone, lireCreation, quotaZones, recetteAEcrire, repondreResolue, reponseRefus, zoneIntrouvable,
} from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Corps = z.object({ nom: z.string().trim().min(1).max(200) }).strict();

const echec = (message: string) => NextResponse.json({ error: message }, { status: 500 });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;
  const id = idDeZone((await params).id);
  if (id instanceof NextResponse) return id;
  const corps = await lireCorps(req, Corps);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const refusQuota = await quotaZones(s.espace);
  if (refusQuota) return refusQuota;
  const { orgId, userId } = s.espace;
  const nom = corps.valeur.nom;

  const supabase = createAdminClient();
  const { data: zone, error } = await supabase
    .from('custom_geo_zones').select('id, recette').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (error) {
    console.error('[zones/dupliquer] lecture :', error.message);
    return NextResponse.json({ error: 'Lecture de la zone impossible.' }, { status: 500 });
  }
  if (!zone) return zoneIntrouvable();

  const mode = modeDuplication(zone.recette);
  if (mode.mode === 'copie') {
    const copie = await supabase.rpc('dupliquer_zone', { p_zone_id: id, p_org_id: orgId, p_nom: nom, p_cree_par: userId });
    const issue = copie.error ? null : lireCopie(copie.data);
    if (issue && 'refus' in issue) return zoneIntrouvable();
    if (!issue) {
      console.error('[zones/dupliquer] dupliquer_zone :', copie.error?.message ?? 'réponse hors contrat', copie.error ? '' : copie.data);
      return echec('Duplication de la zone impossible.');
    }
    // Une zone pays (figée) se copie ; ses compteurs se posent sans lecture géométrique (sql/296).
    return repondreResolue(supabase, issue.id, userId, issue.surface_km2, 'creation', estRecettePays(zone.recette));
  }

  // Recalcul À NEUF : aucune géométrie cliente (la recette est recalculable, `executerDansEspace` n'en lirait pas) ;
  // B15 : les unités constitutives du NOUVEAU calcul (`recetteAEcrire`).
  const r = await executerDansEspace(supabase, s.espace, mode.recette);
  if (!r.ok) return reponseRefus(r);
  const cree = await supabase.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: orgId, p_cree_par: userId, p_recette: toJson(recetteAEcrire(mode.recette, r)),
    p_geometry_geojson: JSON.stringify(r.geometry),
  });
  const issue = cree.error ? null : lireCreation(cree.data);
  if (issue && 'refus' in issue) return reponseRefus({ statut: 422, refus: issue.refus, message: MESSAGES_REFUS[issue.refus] });
  if (!issue) {
    console.error('[zones/dupliquer] creer_zone_recette :', cree.error?.message ?? 'réponse hors contrat', cree.error ? '' : cree.data);
    return echec('Duplication de la zone impossible.');
  }
  // La provenance, sur la NOUVELLE zone seulement (`creer_zone_recette` écrit `{}`), l'UUID en minuscules comme
  // `dupliquer_zone` (relecture 1, m-2). Un échec ne défait pas la zone, qui existe : il se journalise, la réponse
  // reste celle de la création. L'écrire en un seul appel demanderait de modifier `creer_zone_recette` (sql/253),
  // partagée avec `POST /api/zones` : laissé en deux temps (relecture 1, m-1).
  const prov = await supabase.from('custom_geo_zones')
    .update({ source_metadata: { duplique_de: id.toLowerCase() } }).eq('id', issue.id).eq('org_id', orgId);
  if (prov.error) console.error('[zones/dupliquer] provenance :', prov.error.message);
  return repondreResolue(supabase, issue.id, userId, r.surface_km2, 'creation');
}
