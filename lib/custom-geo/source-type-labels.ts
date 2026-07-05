/**
 * MAGELIAN — Mapping source_type technique → label utilisateur readable.
 * Si un type n'est pas dans le mapping, on affiche le source_type brut
 * (en JetBrains Mono côté UI pour signaler que c'est technique).
 */

const SOURCE_TYPE_LABELS: Record<string, string> = {
  isochrone_battle: 'Battle isochrones',
  admin_filter: 'Filtre territorial',
  carreaux_filosofi: 'Carreaux Filosofi',
  voronoi_cells: 'Voronoï',
  radio_coverage: 'Couverture radio',
  iris_selection: 'Sélection IRIS',
  digital_analysis: 'Analyse digital',
  meteo_grid: 'Grille météo',
  tmja_routes: 'Trafic routier',
  composite: 'Composite multi-layers',
};

/**
 * Retourne le label utilisateur si connu, sinon le source_type brut.
 * Indique si on doit le rendre en mono (type technique inconnu).
 */
export function getSourceTypeLabel(sourceType: string): { label: string; isReadable: boolean } {
  const readable = SOURCE_TYPE_LABELS[sourceType];
  if (readable) return { label: readable, isReadable: true };
  return { label: sourceType, isReadable: false };
}
