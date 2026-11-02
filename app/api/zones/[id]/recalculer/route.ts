/**
 * POST /api/zones/[id]/recalculer — rejouer la recette d'une zone de l'espace actif et remplacer sa forme EN PLACE
 * (arbitrage A-2). Sans corps.
 *
 * Ordre (I3) : lecture de la zone (bornée à l'espace actif) → forme figée ? (409 `forme_figee`) → `zone_referencee`
 * (sql/253 ; 409 `zone_referencee` + `par` : strategie · jeu_de_zones · composite · combinaison · perimetre) →
 * SEULEMENT ALORS les sources et le calcul → `remplacer_geometrie_zone_unites` (sql/320 : `remplacer_geometrie_zone`,
 * sql/253, puis les unités constitutives de la recette, B15), qui revérifie les références sous verrou → `resolve_custom_geo_zone_codes` (200, ou 207 si la résolution échoue). Une zone citée ne paie donc jamais
 * un calcul lourd pour un 409, et sa forme ne change jamais sous une campagne.
 *
 * Le message du 409 est le même quel que soit `par` (« utilisée par un plan, un jeu de zones ou une autre zone ») :
 * `par` est un code, jamais montré tel quel — `composite` couvre aussi bien une union qu'une différence ou une
 * intersection. Pas de « dupliquer » dans ce lot (arbitrage de la revue finale). Une COMBINAISON n'est pas
 * recalculable (`TYPES_RECALCULABLES`) : ses opérandes sont figés, elle reçoit le 409 `forme_figee`.
 *
 * Un 207 (résolution des codes en échec) dit « Zone recalculée, mais … » — `repondreResolue(…, 'recalcul')`.
 *
 * Quota unique des routes de zone (`lib/zones/session-zones.ts`), consommé avant la lecture de la zone.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { MESSAGES_REFUS, estRecalculable } from '@/lib/zones/recette';
import { lireRecette } from '@/lib/zones/recette-schema';
import { toJson } from '@/lib/supabase/rpc-json';
import { espaceDeZone, executerDansEspace, idDeZone, quotaZones, recetteAEcrire, repondreResolue, reponseRefus, zoneIntrouvable } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const referencee = (par: string) =>
  NextResponse.json({ error: MESSAGES_REFUS.zone_referencee, refus: 'zone_referencee', par }, { status: 409 });

/**
 * `zone_referencee` est typée `string` par le générateur, mais rend NULL pour une zone libre. Toute chaîne non vide
 * est une référence — un code inconnu de cette liste compte aussi : on refuse plutôt que de recalculer sous un plan.
 */
function lireReference(data: unknown): string | null {
  return typeof data === 'string' && data !== '' ? data : null;
}

/** Rétrécit le `Json` de `remplacer_geometrie_zone_unites` (sql/320, réponse de sql/253) ; `null` = hors contrat. */
function lireRemplacement(data: unknown): { remplace: true } | { refus: 'zone_introuvable' } | { refus: 'zone_referencee'; par: string } | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.refus === 'zone_introuvable') return { refus: 'zone_introuvable' };
  if (o.refus === 'zone_referencee') return { refus: 'zone_referencee', par: typeof o.par === 'string' ? o.par : 'inconnu' };
  return o.remplace === true ? { remplace: true } : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;
  const id = idDeZone((await params).id);
  if (id instanceof NextResponse) return id;
  const refusQuota = await quotaZones(s.espace);
  if (refusQuota) return refusQuota;

  const supabase = createAdminClient();
  const { data: zone, error } = await supabase
    .from('custom_geo_zones').select('id, recette').eq('id', id).eq('org_id', s.espace.orgId).maybeSingle();
  if (error) {
    console.error('[zones/recalculer] lecture :', error.message);
    return NextResponse.json({ error: 'Lecture de la zone impossible.' }, { status: 500 });
  }
  if (!zone) return zoneIntrouvable();
  const lue = zone.recette == null ? null : lireRecette(zone.recette);
  // Une recette STOCKÉE que le schéma refuse est une anomalie (CHECK de sql/253 contourné, schéma resserré depuis) :
  // l'utilisateur reçoit le refus d'une forme figée, mais elle se journalise — une zone d'avant le lot (NULL), non.
  if (lue && !lue.ok) console.error(`[zones/recalculer] recette stockée illisible (zone ${id}) :`, lue.message);
  if (!lue || !lue.ok || !estRecalculable(lue.recette)) {
    return reponseRefus({ statut: 409, refus: 'forme_figee', message: MESSAGES_REFUS.forme_figee });
  }

  // I3 : les références AVANT le calcul — une lecture légère contre jusqu'à 90 000 buffers.
  const ref = await supabase.rpc('zone_referencee', { p_zone_id: id });
  if (ref.error) {
    console.error('[zones/recalculer] références :', ref.error.message);
    return NextResponse.json({ error: 'Lecture de la zone impossible.' }, { status: 500 });
  }
  const par = lireReference(ref.data);
  if (par) return referencee(par);

  // Aucune géométrie cliente : la recette est recalculable, `executerDansEspace` n'en transmettrait pas.
  const r = await executerDansEspace(supabase, s.espace, lue.recette);
  if (!r.ok) return reponseRefus(r);

  // B15 (sql/320) : la forme ET les unités constitutives (les codes d'un seuil sur territoires changent avec les
  // données), dans la même transaction — `null` les retire, la base redérive celles d'une liste de CP.
  const ecrite = recetteAEcrire(lue.recette, r);
  const unites = 'unites_constitutives' in ecrite && ecrite.unites_constitutives ? toJson(ecrite.unites_constitutives) : null;
  const rem = await supabase.rpc('remplacer_geometrie_zone_unites', {
    p_zone_id: id, p_org_id: s.espace.orgId, p_geometry_geojson: JSON.stringify(r.geometry), p_unites: unites,
  });
  const sortie = rem.error ? null : lireRemplacement(rem.data);
  if (!sortie) {
    console.error('[zones/recalculer] remplacer :', rem.error?.message ?? 'réponse hors contrat', rem.error ? '' : rem.data);
    return NextResponse.json({ error: 'Recalcul de la zone impossible.' }, { status: 500 });
  }
  if ('refus' in sortie) return sortie.refus === 'zone_introuvable' ? zoneIntrouvable() : referencee(sortie.par);
  return repondreResolue(supabase, id, s.espace.userId, r.surface_km2, 'recalcul');
}
