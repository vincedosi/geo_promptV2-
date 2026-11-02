/**
 * @file lib/zones/activation-serveur.ts — B8, décision du 02/11 et tour 3 (N-1, N-2) : une zone ne s'ACTIVE (jeu ⑤,
 * extraction, export DSP) que si aucun rayon sous `RAYON_POINT_MIN_M` n'y entre — le sien, ou celui d'une zone
 * source d'une combinaison, à toute profondeur. La règle est pure (`refusActivation`, `lib/zones/recette.ts`) ; ici on
 * LIT les sources, qu'un écran ne connaît pas toujours.
 *
 * Lecture : UNE requête par niveau d'imbrication (`in('id', …)` sur les sources du niveau, dans l'espace), jamais une
 * par zone. Une zone qui n'est pas une combinaison ne lit rien. Une combinaison cite au plus 20 zones (`Zones`,
 * `recette-schema.ts`), chacune vue une fois.
 */
import type { createAdminClient } from '@/lib/auth';
import { refusActivation, type ZoneConnue } from './recette';
import { lireRecette } from './recette-schema';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/**
 * Le refus d'activer la zone de recette `brute` (telle que `custom_geo_zones.recette` la porte), ou `null`. `orgId` :
 * l'espace de la zone, où ses sources sont lues. Lève sur une erreur de lecture : l'appelant répond 500.
 */
export async function refusActivationServeur(supabase: ClientAdmin, orgId: string, brute: unknown): Promise<string | null> {
  const lue = lireRecette(brute);
  const recette = lue.ok ? lue.recette : null;
  const zones = new Map<string, ZoneConnue>();
  let niveau = recette?.type === 'combinaison' ? [...recette.zones] : [];
  while (niveau.length > 0) {
    const { data, error } = await supabase.from('custom_geo_zones').select('id, name, recette')
      .in('id', niveau).eq('org_id', orgId).limit(niveau.length);
    if (error) throw new Error(`lecture des zones d’une combinaison : ${error.message}`);
    const suivant: string[] = [];
    for (const z of (data ?? []) as { id: string; name: string; recette: unknown }[]) {
      const r = lireRecette(z.recette);
      zones.set(z.id, { name: z.name, recette: r.ok ? r.recette : null });
      if (r.ok && r.recette.type === 'combinaison') suivant.push(...r.recette.zones.filter((id) => !zones.has(id)));
    }
    // Une source trop fine déjà vue suffit : le niveau suivant ne se lit pas.
    niveau = refusActivation(recette, zones) ? [] : [...new Set(suivant)].filter((id) => !zones.has(id));
  }
  return refusActivation(recette, zones);
}
