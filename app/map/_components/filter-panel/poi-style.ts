/**
 * Style d'affichage d'un type de POI sur la carte.
 *
 * Déplacé hors de FilterPanel.tsx (2026-09-03) pour que les sous-composants
 * de section puissent le typer sans importer le monolithe. FilterPanel
 * réexporte ces types : les importateurs existants (map/page.tsx,
 * useMapMarkers, useMapDirectActions) ne changent pas.
 */

export interface POIStyle {
  size: string;
  color: string;
}

export type POIStylesMap = Record<string, POIStyle>;
