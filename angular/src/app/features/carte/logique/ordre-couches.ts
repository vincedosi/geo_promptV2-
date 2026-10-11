/**
 * Les couches que React ajoute APRÈS le `load`, hors de `useMapInit.ts`, sans `beforeId` — donc au-dessus de toutes
 * celles du `load`. Score composite (T18, `ScoreMapLayer.tsx:188-196`) : rangé en dernier, une couche posée APRÈS lui
 * côté Angular passe dessous, comme chez React où toutes les autres existaient déjà.
 */
export const COUCHES_APRES_LOAD: readonly string[] = ['score-composite-cp-fill', 'score-composite-cp-line'];

/**
 * L'ORDRE D'EMPILEMENT des couches de la carte principale — celui de React, où toutes les couches naissent au `load`
 * dans un ordre FIXE (`app/copilote/_hooks/useMapInit.ts:223-1060`, ordre des `addLayer`, aucun `beforeId`), du
 * dessous vers le dessus.
 *
 * Côté Angular, chaque couche est posée À LA DEMANDE (première visibilité, première donnée) et re-posée sur la carte
 * recréée par un changement de fond (B11) : l'ordre de pose dépend donc de l'ordre des gestes de l'utilisateur. Sans
 * ce registre, des carreaux allumés APRÈS des POI passeraient au-dessus d'eux, et des POI posés APRÈS les carreaux
 * passeraient au-dessus des carreaux — le contraire de React. `avantDe` rend la couche existante devant laquelle
 * insérer : la première couche, PLUS HAUTE dans cet ordre, déjà présente sur l'instance.
 *
 * ⚠ C'est l'ordre de React qui fait foi, y compris là où il surprend : les POI rendus par MapLibre (nappe de densité
 * `pois-heatmap`, cercles `pois-circles`) sont SOUS les choroplèthes IRIS et carreaux. Les marqueurs DOM (moins de
 * 300 POI) sont au-dessus de tout, le canevas WebGL ne pouvant pas recouvrir un élément HTML.
 * Une couche absente de la liste (couches à venir) est posée au sommet, comme `addLayer` sans `beforeId`.
 */
export const ORDRE_COUCHES: readonly string[] = [
  // POI (T8) — `useMapInit.ts:227-292`
  'pois-heatmap', 'pois-circles',
  // Météo (T11) — `:368-383`
  'meteo-fill', 'meteo-outline',
  // Flux routier (T9) — `:397`
  'tmja-lines',
  // Radio (T9) — `:431-529`
  'radio-clusters', 'radio-cluster-count', 'radio-points', 'radio-heatmap', 'radio-coverage-fill', 'radio-coverage-line',
  // Cercle de zone (T8) — `:605-606`
  'zone-fill', 'zone-outline',
  // Voronoï — `:614-692`
  'voronoi-fill', 'voronoi-line', 'voronoi-pois-circle', 'voronoi-pois-halo',
  // Isochrones — `:739-740`
  'isochrones-fill', 'isochrones-line',
  'wizard-highlight-layer',
  // Clusters (T19-T20) — `:767`
  'clusters-layer',
  // IRIS (T7) — `:860-905`
  'iris-fill', 'iris-border', 'iris-extrusion',
  // Carreaux (T6) — `:931-975`
  'carreaux-mvt-fill', 'carreaux-mvt-extrusion', 'carreaux-mvt-line',
  'test-iso-fill', 'test-iso-line',
  // Bataille (T17) — `:1002-1060`
  'battle-fill', 'battle-ring-line', 'battle-cirfa-border', 'battle-pois-circle', 'battle-pois-halo',
  ...COUCHES_APRES_LOAD,
];

/**
 * La couche devant laquelle insérer `id` (`addLayer(spec, avantDe(carte, id))`) : la première couche située AU-DESSUS
 * de `id` dans `ORDRE_COUCHES` et déjà posée sur cette instance ; `undefined` (sommet) s'il n'y en a aucune, ou si `id`
 * n'est pas dans l'ordre.
 */
export function avantDe(carte: { getLayer(id: string): unknown }, id: string): string | undefined {
  const i = ORDRE_COUCHES.indexOf(id);
  if (i < 0) return undefined;
  for (let j = i + 1; j < ORDRE_COUCHES.length; j++) {
    if (carte.getLayer(ORDRE_COUCHES[j])) return ORDRE_COUCHES[j];
  }
  return undefined;
}
