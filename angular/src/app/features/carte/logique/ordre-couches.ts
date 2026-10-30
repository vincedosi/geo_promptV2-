/**
 * Les couches que React ajoute APRÈS le `load`, hors de `useMapInit.ts`, sans `beforeId` — donc TOUJOURS au-dessus de
 * toutes celles du `load` (IRIS, carreaux, POI, météo, flux routier, radio…), quel que soit l'ordre des gestes.
 *
 * Revue finale du lot 4, I-1 : cette liste ne portait que le score (T18). Les couches posées ensuite par T10, T12-T14
 * et T16 n'y étaient pas, et une couche du `load` allumée APRÈS elles (IRIS après les sites ICPE, par exemple) était
 * posée au sommet, PAR-DESSUS les points ICPE — le contraire de React.
 *
 * Ordre de référence, du dessous vers le dessus — celui du MONTAGE dans `app/map/page.tsx` :
 *   - civique `civic-cps-*` — `<CivicIndicatorsLayer>` (`page.tsx:1186`, couches `CivicIndicatorsLayer.tsx:130-139`) ;
 *   - sites ICPE `risques-*` — `<RisqueIndustrielLayer>` (`page.tsx:1187`, `RisqueIndustrielLayer.tsx:341-386`, dans
 *     cet ordre : zone, contour, halo, point) ;
 *   - PPRT `pprt-*` — `<PprtLayer>` (`page.tsx:1208`, `PprtLayer.tsx:166-180`) ;
 *   - santé `civic-health-zones-*` — `<CivicHealthMapLayer>` (`page.tsx:1244`, `CivicHealthMapLayer.tsx:243-248`) ;
 *   - score composite — `<ScoreMapLayer>` (`page.tsx:1262`, `ScoreMapLayer.tsx:188-196`) ;
 *   - zones de risque — `<ZonesRisqueLayer>` (`page.tsx:1266`, `ZonesRisqueLayer.tsx:172-201`). Angular les nomme
 *     `atelier-zones-*` (couches du module risque réemployées, `features/risques/cartes/couches-zones.ts`) là où React
 *     écrit `zones-risque-*` : mêmes trois couches, même ordre ;
 *   - puis les tracés de l'UTILISATEUR, posés par un geste dans le panneau Zones (monté dans `<OverlayPanel>`,
 *     `page.tsx:1176`) : zones enregistrées `custom-zone-*` (`ZonesOverlay.tsx:233-240`), aperçu du rayon
 *     (`CreerZoneRayon.tsx:118-161`), tracé libre (`DessinLibre.tsx`, terra-draw, dont les couches naissent au
 *     début du tracé). Chez React, ces trois-là naissent AU MOMENT du geste, sans `beforeId`, donc au-dessus de tout
 *     ce qui est déjà peint : ce qu'on dessine n'est jamais caché sous une couche de données.
 *
 * ⚠ Entre elles, chez React, ces couches s'empilent dans l'ordre d'arrivée de leurs données (toutes sont posées dans
 * un effet asynchrone) : il n'y a pas d'ordre « React » plus fixe que celui du montage, retenu ici. Ce qui est
 * INVARIANT chez React — et que ce registre garantit — c'est qu'elles restent toutes au-dessus des couches du `load`.
 *
 * Une entrée terminée par `*` est un PRÉFIXE : les zones enregistrées portent l'identifiant de la zone
 * (`custom-zone-fill-<id>`, `custom-zone-line-<id>`). Une couche du groupe est posée au SOMMET de son groupe, comme
 * React au clic « Afficher ».
 */
export const COUCHES_APRES_LOAD: readonly string[] = [
  'civic-cps-fill', 'civic-cps-line',
  'risques-zone', 'risques-zone-contour', 'risques-halo', 'risques-point',
  'pprt-fond', 'pprt-contour',
  'civic-health-zones-fill', 'civic-health-zones-line',
  'score-composite-cp-fill', 'score-composite-cp-line',
  'atelier-zones-fond', 'atelier-zones-contour', 'atelier-zones-pprt', 'atelier-zones-etiquettes',
  'custom-zone-*',
  // ④ Couverture d'une zone (lot 4, T8) : la part de chaque CP / IRIS, au-dessus des zones enregistrées (c'est la
  // lecture d'UNE d'elles), sous les points d'une campagne et les tracés de l'utilisateur. Le contour de la zone et la
  // surbrillance du territoire survolé en dernier. Sans équivalent React.
  'couverture-cp-fill', 'couverture-cp-line', 'couverture-iris-fill', 'couverture-iris-line',
  'couverture-cp-survol', 'couverture-iris-survol', 'couverture-zone-line',
  // ⑤ Jeu de zones (lot 5, T11) : les unités de la plateforme regardée, rangées comme la couverture de ④ (A-14).
  'jeu-unites-fill', 'jeu-unites-line', 'jeu-iris-fill', 'jeu-iris-line', 'jeu-zone-line',
  // ④ Couverture par rayon (lot 4, T12) : les cercles autour des POI retenus, puis les POI. Sans équivalent React.
  'couverture-rayon-fill', 'couverture-rayon-line', 'couverture-rayon-poi',
  // ④ Typologies des POI de la zone (④ finitions, T8) : des points, puis ceux de la typologie survolée. Sans équivalent React.
  'couverture-typologies-poi', 'couverture-typologies-survol',
  // Emplacements d'une campagne OOH (spec 2026-10-16-ooh-campagnes § 6) : des POINTS, au-dessus des zones
  // enregistrées (un aplat à 25 % ne les cache pas), sous l'aperçu du rayon et le tracé libre. Sans équivalent React.
  'campagne-ooh-points', 'campagne-ooh-a-verifier',
  'apercu-rayon-fill', 'apercu-rayon-line',
  'apercu-zone-fill', 'apercu-zone-line',
  'dessin-trace-fill', 'dessin-trace-line', 'dessin-trace-point',
];

/**
 * L'ORDRE D'EMPILEMENT des couches de la carte principale — celui de React, où les couches du `load` naissent dans
 * un ordre FIXE (`app/map/_hooks/useMapInit.ts:223-1060`, ordre des `addLayer`, aucun `beforeId`), du dessous
 * vers le dessus, puis celles posées après le `load` (`COUCHES_APRES_LOAD`), toujours au-dessus.
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
 * Une couche absente de la liste est posée au sommet, comme `addLayer` sans `beforeId` — et une couche de la liste
 * posée ensuite passe alors au-dessus d'elle : TOUTE couche de la carte principale doit donc y figurer
 * (`tests/unit/angular/carte-ordre-couches.test.ts` vérifie les poseurs connus).
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
  // (Voronoï supprimé le 30/10/2026 — décision Vincent : ses quatre couches sont retirées des deux applications.)
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

/** Ce qu'`avantDe` lit de la carte. `getStyle` (couches rendues, du dessous vers le dessus) sert aux préfixes. */
export interface CarteOrdonnee {
  getLayer(id: string): unknown;
  getStyle?(): { layers?: readonly { id: string }[] } | undefined;
}

/** L'entrée `e` de `ORDRE_COUCHES` désigne-t-elle la couche `id` (identifiant exact, ou préfixe terminé par `*`) ? */
function designe(e: string, id: string): boolean {
  return e.endsWith('*') ? id.startsWith(e.slice(0, -1)) : e === id;
}

/** Le rang de `id` dans `ORDRE_COUCHES` (préfixes compris), `-1` s'il n'y figure pas. */
export function rangCouche(id: string): number {
  return ORDRE_COUCHES.findIndex((e) => designe(e, id));
}

/**
 * La couche devant laquelle insérer `id` (`addLayer(spec, avantDe(carte, id))`) : la première couche située AU-DESSUS
 * de `id` dans `ORDRE_COUCHES` et déjà posée sur cette instance ; `undefined` (sommet) s'il n'y en a aucune, ou si `id`
 * n'est pas dans l'ordre. Pour une entrée préfixe, la plus BASSE des couches rendues qui portent ce préfixe.
 */
export function avantDe(carte: CarteOrdonnee, id: string): string | undefined {
  const i = rangCouche(id);
  if (i < 0) return undefined;
  for (let j = i + 1; j < ORDRE_COUCHES.length; j++) {
    const e = ORDRE_COUCHES[j];
    if (!e.endsWith('*')) {
      if (carte.getLayer(e)) return e;
      continue;
    }
    const trouvee = carte.getStyle?.()?.layers?.find((c) => designe(e, c.id));
    if (trouvee) return trouvee.id;
  }
  return undefined;
}
