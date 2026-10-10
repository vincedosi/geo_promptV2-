import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';
import { TEINTES_RADIO } from '../logique/palettes-donnees-carte';
import { rgbDe } from './couche-pois';

/**
 * La couche radio FM/DAB+ — fonctions PURES sur l'instance MapLibre, testées sur la carte factice (patron de
 * `couche-pois.ts`, T8). Portage de `useMapInit.ts:420-598` (sources, six couches, popup, zoom sur grappe) et des
 * peintures que `useRadioLayer.ts:132-183` rejouait à chaque réglage.
 *
 * ── COULEURS ─────────────────────────────────────────────────────────────
 * Les teintes de DONNÉES (portée, gris des autres radios, cœur de la carte de chaleur) sont des littéraux nommés de
 * `TEINTES_RADIO` (B12) ; les couleurs d'INTERFACE — le teal des grappes, de la radio choisie et de la carte de chaleur,
 * le sombre invariant des cernes et du texte — sont des jetons lus par `CouleursService` (`JETONS_RADIO`), passés à
 * MapLibre en valeurs calculées, jamais `var()`.
 */
export const SOURCE_EMETTEURS = 'radio-emetteurs';
export const SOURCE_COUVERTURE = 'radio-coverage';
export const COUCHE_GRAPPES = 'radio-clusters';
export const COUCHE_COMPTE = 'radio-cluster-count';
export const COUCHE_POINTS = 'radio-points';
export const COUCHE_CHALEUR = 'radio-heatmap';
export const COUCHE_COUVERTURE_FOND = 'radio-coverage-fill';
export const COUCHE_COUVERTURE_TRAIT = 'radio-coverage-line';
export const COUCHES_RADIO = [
  COUCHE_GRAPPES, COUCHE_COMPTE, COUCHE_POINTS, COUCHE_CHALEUR, COUCHE_COUVERTURE_FOND, COUCHE_COUVERTURE_TRAIT,
] as const;

/** Au plus 500 cercles de couverture, chacun de 64 segments (`useRadioLayer.ts:222-230`). */
export const MAX_CERCLES = 500;
export const SEGMENTS_CERCLE = 64;
/** « Recentrer France » (`page.tsx:1017`). */
export const CADRE_FRANCE: [[number, number], [number, number]] = [[-5.5, 41.3], [9.6, 51.1]];

/** Les jetons d'interface de la couche, lus par `CouleursService.palette`. */
export const JETONS_RADIO = {
  grappes: TEINTES_RADIO.jetonGrappes,
  texteGrappes: TEINTES_RADIO.jetonTexteGrappes,
  cernes: TEINTES_RADIO.jetonCernes,
  choisie: TEINTES_RADIO.jetonChoisie,
} as const;
export type CouleursRadio = Record<keyof typeof JETONS_RADIO, string>;

/** Les réglages de la section qui se peignent (aucun ne part en requête). */
export interface ReglagesRadio {
  visible: boolean;
  densite: boolean;
  couverture: boolean;
  couleurCouverture: string;
  /** En pour cent (0-100), comme la réglette. */
  opaciteCouverture: number;
  contour: number;
  taillePoints: number;
  selectionId: string | null;
}

export type CarteRadio = Pick<
  maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setPaintProperty' | 'setLayoutProperty'
>;

const vide = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const zoomInterpole = (paires: ReadonlyArray<readonly [number, number]>) => ['interpolate', ['linear'], ['zoom'], ...paires.flat()];

/** La rampe de la carte de chaleur : le teal à l'opacité de chaque densité, puis le cœur invariant (`useMapInit.ts:496-503`). */
export function couleurChaleur(teal: string): unknown[] | null {
  const rgb = rgbDe(teal);
  if (!rgb) return null;
  const { r, g, b } = rgb;
  return ['interpolate', ['linear'], ['heatmap-density'],
    ...TEINTES_RADIO.densiteChaleur.flatMap(([d, a]) => [d, `rgba(${r},${g},${b},${a})`]),
    1, TEINTES_RADIO.coeurChaleur,
  ];
}

/** La couleur des points : par portée, ou la radio choisie en teal et les autres en gris (`useRadioLayer.ts:164-183`). */
export function couleurPoints(selectionId: string | null, teal: string): unknown[] {
  if (selectionId) return ['case', ['==', ['get', 'radio_id'], selectionId], teal, TEINTES_RADIO.pointNonChoisi];
  return ['match', ['get', 'portee'], ...Object.entries(TEINTES_RADIO.portee).flat(), TEINTES_RADIO.porteeInconnue];
}

export function opacitePoints(selectionId: string | null): unknown {
  const o = TEINTES_RADIO.opacitePoints;
  return selectionId ? ['case', ['==', ['get', 'radio_id'], selectionId], o.choisie, o.autres] : o.normale;
}

/** Les peintures de la couverture (`useRadioLayer.ts:156-161`) : la ligne est 20 points plus opaque que le fond. */
export function peinturesCouverture(r: Pick<ReglagesRadio, 'couleurCouverture' | 'opaciteCouverture' | 'contour'>) {
  return {
    fond: { 'fill-color': r.couleurCouverture, 'fill-opacity': r.opaciteCouverture / 100 },
    trait: {
      'line-color': r.couleurCouverture,
      'line-opacity': Math.min(r.opaciteCouverture / 100 + 0.2, 1),
      'line-width': r.contour,
    },
  };
}

/**
 * La visibilité de chaque couche (`useRadioLayer.ts:137-153`) : grappes, compte et points OU carte de chaleur ; la
 * couverture seulement si le calque est visible.
 */
export function visibilitesRadio(r: Pick<ReglagesRadio, 'visible' | 'densite' | 'couverture'>): Record<string, 'visible' | 'none'> {
  const v = (b: boolean) => (b ? 'visible' : 'none') as 'visible' | 'none';
  const grappes = r.visible && !r.densite;
  return {
    [COUCHE_GRAPPES]: v(grappes), [COUCHE_COMPTE]: v(grappes), [COUCHE_POINTS]: v(grappes),
    [COUCHE_CHALEUR]: v(r.visible && r.densite),
    [COUCHE_COUVERTURE_FOND]: v(r.visible && r.couverture), [COUCHE_COUVERTURE_TRAIT]: v(r.visible && r.couverture),
  };
}

/**
 * Pose les deux sources et les six couches (`useMapInit.ts:420-530`), IDEMPOTENT, chacune à sa place dans l'ordre de
 * React (`avantDe`), avec les réglages COURANTS : React les posait avec des valeurs que son effet de synchronisation
 * écrasait aussitôt (rayon par puissance, opacités de couverture 0,06 / 0,25) ; la couche naît ici avec ce qu'elle
 * affiche.
 */
export function poserCouchesRadio(carte: CarteRadio, c: CouleursRadio, r: ReglagesRadio): void {
  const vis = visibilitesRadio(r);
  if (!carte.getSource(SOURCE_EMETTEURS)) {
    carte.addSource(SOURCE_EMETTEURS, {
      type: 'geojson', data: vide(), cluster: true,
      clusterMaxZoom: TEINTES_RADIO.groupement.clusterMaxZoom, clusterRadius: TEINTES_RADIO.groupement.clusterRadius,
    });
  }
  const g = TEINTES_RADIO.grappes;
  const ajouter = (spec: Record<string, unknown>) => {
    const id = String(spec['id']);
    if (carte.getLayer(id)) return;
    const layout = { ...(spec['layout'] as object | undefined), visibility: vis[id] };
    carte.addLayer({ ...spec, layout } as maplibregl.LayerSpecification, avantDe(carte, id));
  };
  ajouter({
    id: COUCHE_GRAPPES, type: 'circle', source: SOURCE_EMETTEURS, filter: ['has', 'point_count'],
    paint: {
      'circle-color': c.grappes,
      'circle-radius': ['step', ['get', 'point_count'], TEINTES_RADIO.rayonGrappes.defaut, ...TEINTES_RADIO.rayonGrappes.paliers.flat()],
      'circle-opacity': g.opacite, 'circle-stroke-width': g.cerne, 'circle-stroke-color': c.cernes,
    },
  });
  ajouter({
    id: COUCHE_COMPTE, type: 'symbol', source: SOURCE_EMETTEURS, filter: ['has', 'point_count'],
    layout: { 'text-field': '{point_count_abbreviated}', 'text-font': [g.police], 'text-size': g.tailleTexte },
    paint: { 'text-color': c.texteGrappes },
  });
  ajouter({
    id: COUCHE_POINTS, type: 'circle', source: SOURCE_EMETTEURS, filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': couleurPoints(r.selectionId, c.choisie),
      'circle-radius': r.taillePoints,
      'circle-stroke-width': ['match', ['get', 'systeme'], 'DAB+', TEINTES_RADIO.cernePoint['DAB+'], TEINTES_RADIO.cernePoint['defaut']],
      'circle-stroke-color': c.cernes,
      'circle-opacity': opacitePoints(r.selectionId),
    },
  });
  const chaleur: Record<string, unknown> = {
    'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'puissance_w'], 100], ...TEINTES_RADIO.poidsChaleur.flat()],
    'heatmap-intensity': zoomInterpole(TEINTES_RADIO.intensiteChaleur),
    'heatmap-radius': zoomInterpole(TEINTES_RADIO.rayonChaleur),
    'heatmap-opacity': zoomInterpole(TEINTES_RADIO.opaciteChaleur),
  };
  const rampe = couleurChaleur(c.grappes);
  if (rampe) chaleur['heatmap-color'] = rampe;
  ajouter({ id: COUCHE_CHALEUR, type: 'heatmap', source: SOURCE_EMETTEURS, maxzoom: TEINTES_RADIO.zoomMaxChaleur, paint: chaleur });

  if (!carte.getSource(SOURCE_COUVERTURE)) carte.addSource(SOURCE_COUVERTURE, { type: 'geojson', data: vide() });
  const p = peinturesCouverture(r);
  ajouter({ id: COUCHE_COUVERTURE_FOND, type: 'fill', source: SOURCE_COUVERTURE, paint: p.fond });
  ajouter({ id: COUCHE_COUVERTURE_TRAIT, type: 'line', source: SOURCE_COUVERTURE, paint: p.trait });
}

/** `setPaintProperty` qui ne lève jamais sur une couche absente (carte en cours de recréation). */
export function peindreRadio(carte: CarteRadio, couche: string, propriete: string, valeur: unknown): void {
  if (!carte.getLayer(couche)) return;
  try { carte.setPaintProperty(couche, propriete, valeur); } catch { /* couche retirée entre-temps */ }
}

export function montrerRadio(carte: CarteRadio, r: Pick<ReglagesRadio, 'visible' | 'densite' | 'couverture'>): void {
  for (const [couche, v] of Object.entries(visibilitesRadio(r))) {
    if (carte.getLayer(couche)) carte.setLayoutProperty(couche, 'visibility', v);
  }
}

/**
 * Les cercles de couverture, calculés côté client (`useRadioLayer.ts:216-245`) : les 500 PREMIERS émetteurs, ceux dont
 * le rayon dépasse 100 m, 64 segments, même approximation plane que React (111 320 m par degré).
 */
export function cerclesCouverture(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const cercles: GeoJSON.Feature[] = [];
  for (const f of fc.features.slice(0, MAX_CERCLES)) {
    if (f.geometry?.type !== 'Point') continue;
    const [lng, lat] = f.geometry.coordinates;
    const rayon = Number((f.properties as Record<string, unknown> | null)?.['rayon_couverture_m'] ?? 0);
    if (!rayon || rayon < 100) continue;
    const coords: [number, number][] = [];
    for (let i = 0; i <= SEGMENTS_CERCLE; i++) {
      const angle = (i / SEGMENTS_CERCLE) * 2 * Math.PI;
      const dlat = (rayon / 111320) * Math.cos(angle);
      const dlng = (rayon / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
      coords.push([lng + dlng, lat + dlat]);
    }
    cercles.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} });
  }
  return { type: 'FeatureCollection', features: cercles };
}

/** L'emprise des points d'une collection, ou `null` (`useRadioLayer.ts:110-123`) — pour cadrer la radio choisie. */
export function empriseEmetteurs(fc: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
  for (const f of fc.features) {
    if (f.geometry?.type !== 'Point') continue;
    const [lng, lat] = f.geometry.coordinates;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return minLng < maxLng ? [[minLng, minLat], [maxLng, maxLat]] : null;
}

function texte(doc: Document, valeur: string, style: Partial<CSSStyleDeclaration>): HTMLElement {
  const el = doc.createElement('div');
  el.textContent = valeur;
  Object.assign(el.style, style);
  return el;
}

/** La puissance lisible : `1.2 MW`, `3.5 kW`, `500 W`, ou rien (`useMapInit.ts:542`). */
export function puissanceLisible(w: number): string {
  if (!(w > 0)) return '';
  if (w >= 1000000) return `${(w / 1000000).toFixed(1)} MW`;
  if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${w} W`;
}

/**
 * La popup d'un émetteur (`useMapInit.ts:534-565`), construite par `textContent` — jamais `setHTML` : React échappait
 * chaque champ à la main. Mêmes lignes, mêmes tailles, mêmes jetons de texte. 87,5 et 108 MHz (bornes de la bande FM)
 * s'affichent « FM ».
 */
export function contenuPopupRadio(p: Record<string, unknown>, doc: Document): HTMLElement {
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const nom = p['radio_nom'] ? s(p['radio_nom']) : null;
  const sys = s(p['systeme'] ?? 'FM');
  const freq = Number(p['frequence_mhz']);
  const freqLisible = freq && freq !== 87.5 && freq !== 108 ? `${freq.toFixed(1)} MHz` : sys;
  const pw = puissanceLisible(Number(p['puissance_w']));
  const couv = Number(p['rayon_couverture_m']);
  const cov = couv > 0 ? `~${Math.round(couv / 1000)} km` : '';
  const cat = p['categorie_arcom'] ? `Cat. ${s(p['categorie_arcom'])}` : '';
  const portee = p['portee'] ? s(p['portee']).charAt(0).toUpperCase() + s(p['portee']).slice(1) : '';
  const genre = p['genre'] ? s(p['genre']).replace('_', '/') : '';
  const groupe = p['groupe_media'] ? s(p['groupe_media']) : '';

  const racine = doc.createElement('div');
  racine.setAttribute('data-popup-radio', '');
  Object.assign(racine.style, { padding: '10px 14px', fontFamily: "'Inter',sans-serif", fontSize: '12px', lineHeight: '1.6' });
  racine.append(texte(doc, nom || 'Radio non associée', {
    fontSize: '14px', fontWeight: '600', color: nom ? 'var(--text-primary)' : 'var(--text-tertiary)', marginBottom: '2px',
  }));
  if (nom) {
    racine.append(texte(doc, [cat, portee, genre].filter(Boolean).join(' · '), {
      color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '6px',
    }));
  }
  if (groupe) racine.append(texte(doc, `Groupe : ${groupe}`, { color: 'var(--text-tertiary)', fontSize: '11px', marginBottom: '6px' }));
  const bloc = doc.createElement('div');
  Object.assign(bloc.style, { borderTop: '0.5px solid var(--border-subtle)', margin: '4px 0', paddingTop: '4px' });
  bloc.append(texte(doc, freqLisible, { color: 'var(--text-secondary)', fontSize: '11px' }));
  if (pw) bloc.append(texte(doc, `Puissance : ${pw}`, { color: 'var(--text-tertiary)', fontSize: '11px' }));
  if (cov) bloc.append(texte(doc, `Couverture : ${cov}`, { color: 'var(--text-tertiary)', fontSize: '11px' }));
  bloc.append(texte(doc, [s(p['commune']), p['departement'] ? `Dept ${s(p['departement'])}` : ''].filter(Boolean).join(' · '), {
    color: 'var(--text-tertiary)', fontSize: '11px',
  }));
  if (p['exploitant']) bloc.append(texte(doc, `Exploitant : ${s(p['exploitant'])}`, { color: 'var(--text-tertiary)', fontSize: '10px' }));
  racine.append(bloc);
  return racine;
}
