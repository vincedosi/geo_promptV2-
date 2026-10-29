/**
 * @file lib/zones/dupliquer.ts — « Dupliquer » une zone (③ finitions, T2 ; V-4, Q-3, arbitrage A-5).
 *
 * Deux chemins, choisis par la recette STOCKÉE de la zone source :
 * - recette recalculable (`estRecalculable`) → elle est exécutée À NEUF par l'exécuteur serveur : la copie a la forme
 *   d'aujourd'hui (c'est « Recalculer dans une nouvelle zone » pour une zone citée par un plan, que A-2 interdit de
 *   recalculer en place) ;
 * - forme figée (dessin, import, isochrone, capture, combinaison), recette NULL (zone d'avant le lot 3) ou recette
 *   stockée illisible → la forme est copiée EN BASE par `dupliquer_zone` (sql/294) : aucune géométrie ne passe par
 *   Node ni par le navigateur.
 * Dans les deux cas la zone source n'est jamais écrite, et la copie porte `source_metadata.duplique_de`.
 */
import type { Recette } from './recette';
import { estRecalculable } from './recette';
import { lireRecette } from './recette-schema';

export type ModeDuplication = { mode: 'recalcul'; recette: Recette } | { mode: 'copie' };

/** Le chemin d'une duplication, d'après la recette stockée (`custom_geo_zones.recette`, `null` avant le lot 3). */
export function modeDuplication(recetteStockee: unknown): ModeDuplication {
  if (recetteStockee == null) return { mode: 'copie' };
  const lue = lireRecette(recetteStockee);
  if (!lue.ok) {
    // CHECK de sql/253 contourné, ou schéma resserré depuis : la forme stockée reste la vérité, on la copie.
    console.error('[zones/dupliquer] recette stockée illisible :', lue.message);
    return { mode: 'copie' };
  }
  return estRecalculable(lue.recette) ? { mode: 'recalcul', recette: lue.recette } : { mode: 'copie' };
}

/** Rétrécit le `Json` de `dupliquer_zone` (sql/294) : `{ id, surface_km2 }`, `{ refus }` du contrat, sinon `null`. */
export function lireCopie(data: unknown): { id: string; surface_km2: number | null } | { refus: 'zone_introuvable' } | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.refus === 'zone_introuvable') return { refus: 'zone_introuvable' };
  if (typeof o.id !== 'string' || o.id === '') return null;
  return { id: o.id, surface_km2: typeof o.surface_km2 === 'number' && Number.isFinite(o.surface_km2) ? o.surface_km2 : null };
}
