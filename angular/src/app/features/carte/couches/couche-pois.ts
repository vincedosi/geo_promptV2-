import type maplibregl from 'maplibre-gl';
import { elementTexte } from '../../../carte/contenu-popup';
import { avantDe } from '../logique/ordre-couches';
import { getCatColor } from '../logique/palettes-donnees-carte';
import { PIN_COLORS, type POIStylesMap } from '../logique/constantes-calques';
import type { POI, SelectedBillboard, ZoneData } from '../data/carte.api';

/**
 * Les POI de la carte principale — fonctions PURES sur l'instance MapLibre et le DOM, testées sur la carte factice.
 * Portage de `useMapInit.ts:42-82` (canevas des rayons), `:223-360` (nappe `pois-heatmap`, cercles `pois-circles`,
 * popups), `:601-606` (cercle de zone) et de `app/map/_hooks/useMapMarkers.ts` (marqueurs DOM, couleur de la nappe,
 * cadrage).
 *
 * ── TROIS RENDUS, SELON LE VOLUME (`useMapMarkers.ts:12-18`) ─────────────
 * - plus de 500 POI, ou mode densité forcé → nappe `pois-heatmap` (et cercles GPU à partir de z11) ;
 * - plus de 300 POI → cercles GPU seuls (`pois-circles`, visibles à partir de z11) ;
 * - sinon → marqueurs DOM et leurs popups.
 *
 * ── COULEURS ─────────────────────────────────────────────────────────────
 * Les couleurs de CATÉGORIE (`getCatColor`), d'épingle choisie (`PIN_COLORS`), l'échelle bleue de la nappe et le
 * violet par défaut des cercles sont des couleurs de DONNÉES (exception B12). Les couleurs d'INTERFACE — le cerne des
 * points, le teal du cercle de zone et de la nappe sans catégorie — sont des jetons lus par `CouleursService` ; une
 * couleur d'épingle écrite `var(--x)` (« Noir » = `var(--bg-level-2)`) est RÉSOLUE avant d'entrer dans MapLibre, qui
 * rejetterait l'expression (ruling T2).
 */
export const SOURCE_POIS = 'pois-heat';
export const COUCHE_POIS_DENSITE = 'pois-heatmap';
export const COUCHE_POIS_CERCLES = 'pois-circles';
export const SOURCE_ZONE = 'zone-circle';
export const COUCHE_ZONE_FOND = 'zone-fill';
export const COUCHE_ZONE_CONTOUR = 'zone-outline';

/** Seuils de rendu (`useMapMarkers.ts:131-133`). */
export const SEUIL_DENSITE = 500;
export const SEUIL_COUCHES = 300;
/** Diamètre des épingles par taille (`useMapMarkers.ts:183`). */
export const TAILLE_EPINGLE_PX: Record<string, number> = { Petite: 8, Standard: 12, Grosse: 16, Large: 22 };
/** Couleur par défaut d'un cercle sans couleur (`useMapInit.ts:275`) — donnée (B12). */
export const COULEUR_CERCLE_DEFAUT = '#6366f1';
/** Les catégories qui ouvrent le tiroir Street View au clic (`useMapMarkers.ts:224`). */
export const CATEGORIES_PANNEAU = new Set(['panneaux', 'top_ooh']);

/** Les jetons d'interface de la couche — ceux des épingles écrites `var(--x)` compris, pour les résoudre. */
export const JETONS_POIS: Record<string, string> = {
  contour: 'poi-contour',
  teal: 'brand-teal',
  // Une couleur `var(--x)` se résout par la clé `x` : le teal de la nappe sans épingle (`var(--brand-teal)`) aussi.
  'brand-teal': 'brand-teal',
  ...Object.fromEntries(
    PIN_COLORS.map((c) => /^var\(\s*--([\w-]+)\s*\)$/.exec(c.hex)?.[1]).filter((n): n is string => !!n).map((n) => [n, n]),
  ),
};

/** La surface de MapLibre que la couche emploie. */
export type CartePois = Pick<
  maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setPaintProperty' | 'setLayoutProperty'
>;

/**
 * Résout une couleur écrite `var(--x)` avec la palette des jetons ; toute autre valeur passe telle quelle. Un jeton
 * inconnu de la palette rend `null` : l'appelant garde alors la couleur par défaut plutôt que d'en inventer une.
 */
export function resoudreCouleur(couleur: string, palette: Record<string, string>): string | null {
  const jeton = /^var\(\s*--([\w-]+)\s*\)$/.exec(couleur.trim());
  if (!jeton) return couleur;
  return palette[jeton[1]] ?? null;
}

/** `resolveCssRgb` de `useMapMarkers.ts:41-74`, sans la lecture de `:root` (les jetons sont résolus avant). */
export function rgbDe(couleur: string): { r: number; g: number; b: number } | null {
  const v = couleur.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16) };
  }
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return { r: parseInt(v[1] + v[1], 16), g: parseInt(v[2] + v[2], 16), b: parseInt(v[3] + v[3], 16) };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (fn) {
    const [r, g, b] = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if ([r, g, b].every((n) => Number.isFinite(n))) return { r, g, b };
  }
  return null;
}

/** La couleur d'un POI : son épingle choisie, sinon la surcharge de la zone, sinon sa catégorie (`useMapMarkers.ts:140`). */
export function couleurPoi(p: Pick<POI, 'categorie'>, styles: POIStylesMap, zone: Pick<ZoneData, 'couleur_overrides'>): string {
  return styles[p.categorie]?.color ?? zone.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
}

/** Quel rendu pour ce volume : nappe, cercles GPU ou marqueurs DOM (`useMapMarkers.ts:131-133`). */
export function modeRendu(nb: number, densiteForcee: boolean): 'densite' | 'couches' | 'marqueurs' {
  if (densiteForcee || nb > SEUIL_DENSITE) return 'densite';
  return nb > SEUIL_COUCHES ? 'couches' : 'marqueurs';
}

/**
 * Les entités de la source `pois-heat` (`useMapMarkers.ts:137-148`) — complétées de la sous-catégorie, de l'adresse et
 * des champs du copilote, que le clic sur un cercle LIT mais que React n'écrivait pas (défaut corrigé : le tiroir
 * affichait « FMT — » pour tout panneau cliqué en mode cercles, et la popup perdait sous-catégorie et adresse).
 */
export function entitesPois(zone: ZoneData, styles: POIStylesMap, palette: Record<string, string>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zone.pois.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id, categorie: p.categorie, nom: p.nom ?? '',
        color: resoudreCouleur(couleurPoi(p, styles, zone), palette) ?? COULEUR_CERCLE_DEFAUT,
        lat: p.lat, lng: p.lng,
        ...(p.sous_categorie ? { sous_categorie: p.sous_categorie } : {}),
        ...(p.adresse ? { adresse: p.adresse } : {}),
        ...(p.score_ooh != null ? { score_ooh: p.score_ooh } : {}),
        ...(p.audience != null ? { audience: p.audience } : {}),
        ...(p.rank != null ? { rank: p.rank } : {}),
      },
    })),
  };
}

/**
 * La couleur de la nappe de densité (`useMapMarkers.ts:154-174`) : celle de l'épingle — ou de la surcharge — de la
 * PREMIÈRE catégorie affichée, sinon le teal de marque. `null` si la couleur est illisible : la nappe garde alors
 * l'échelle bleue de sa création, comme React.
 */
export function couleurNappe(zone: ZoneData, styles: POIStylesMap, palette: Record<string, string>): unknown[] | null {
  const premiere = zone.pois[0]?.categorie;
  const brute = (premiere && styles[premiere]?.color) || zone.couleur_overrides?.[premiere ?? ''] || 'var(--brand-teal)';
  const resolue = resoudreCouleur(brute, palette);
  const rgb = resolue ? rgbDe(resolue) : null;
  if (!rgb) return null;
  const { r, g, b } = rgb;
  return ['interpolate', ['linear'], ['heatmap-density'],
    0, `rgba(${r},${g},${b},0)`,
    0.15, `rgba(${r},${g},${b},0.25)`,
    0.4, `rgba(${r},${g},${b},0.55)`,
    0.7, `rgba(${r},${g},${b},0.82)`,
    1, `rgba(${r},${g},${b},1)`,
  ];
}

/** Les couleurs d'interface résolues que la pose emploie. */
export interface CouleursPoisPose {
  contour: string;
  teal: string;
}

/**
 * Pose les deux sources et leurs quatre couches (`useMapInit.ts:223-292`, `:601-606`), IDEMPOTENT : chaque ajout
 * teste l'instance COURANTE. Chaque couche s'insère à sa place dans l'ordre de React (`avantDe`) : la nappe et les
 * cercles SOUS toutes les autres, le cercle de zone entre la radio et le Voronoï.
 */
export function poserCouchesPois(carte: CartePois, c: CouleursPoisPose): void {
  const vide: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  if (!carte.getSource(SOURCE_POIS)) carte.addSource(SOURCE_POIS, { type: 'geojson', data: vide });
  if (!carte.getLayer(COUCHE_POIS_DENSITE)) {
    carte.addLayer({
      id: COUCHE_POIS_DENSITE, type: 'heatmap', source: SOURCE_POIS, maxzoom: 14,
      paint: {
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 6, 1.5, 9, 2.5],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 3, 5, 10, 9, 20, 12, 30],
        // Palette bleu-marine (style INSEE) : une échelle de DONNÉES (B12), remplacée par la couleur de la catégorie.
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(33,102,172,0)', 0.15, '#c6dbef', 0.35, '#6baed6', 0.60, '#2171b5', 0.80, '#08519c', 1, '#08306b'],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11, 1, 13, 0],
      },
      layout: { visibility: 'none' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_POIS_DENSITE));
  }
  if (!carte.getLayer(COUCHE_POIS_CERCLES)) {
    carte.addLayer({
      id: COUCHE_POIS_CERCLES, type: 'circle', source: SOURCE_POIS, minzoom: 11,
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], COULEUR_CERCLE_DEFAUT],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 7, 3, 11, 4, 13, 6, 16, 9],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': c.contour,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 7, 0.85, 12.5, 1],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 7, 0.4, 12.5, 0.9],
      },
      layout: { visibility: 'none' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_POIS_CERCLES));
  }
  if (!carte.getSource(SOURCE_ZONE)) carte.addSource(SOURCE_ZONE, { type: 'geojson', data: vide });
  if (!carte.getLayer(COUCHE_ZONE_FOND)) {
    carte.addLayer({
      id: COUCHE_ZONE_FOND, type: 'fill', source: SOURCE_ZONE, paint: { 'fill-color': c.teal, 'fill-opacity': 0.08 },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_ZONE_FOND));
  }
  if (!carte.getLayer(COUCHE_ZONE_CONTOUR)) {
    carte.addLayer({
      id: COUCHE_ZONE_CONTOUR, type: 'line', source: SOURCE_ZONE,
      paint: { 'line-color': c.teal, 'line-width': 1.5, 'line-dasharray': [4, 3] },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_ZONE_CONTOUR));
  }
}

/** `setPaintProperty` / `setLayoutProperty` qui ne lèvent jamais sur une couche absente. */
export function peindrePois(carte: CartePois, couche: string, propriete: string, valeur: unknown): void {
  if (!carte.getLayer(couche)) return;
  try { carte.setPaintProperty(couche, propriete, valeur); } catch { /* couche retirée entre-temps */ }
}
export function montrerPois(carte: CartePois, couche: string, visible: boolean): void {
  if (!carte.getLayer(couche)) return;
  try { carte.setLayoutProperty(couche, 'visibility', visible ? 'visible' : 'none'); } catch { /* idem */ }
}

/** Le panneau d'un POI cliqué, pour le tiroir (`useMapMarkers.ts:225-229`). */
export function panneauDePoi(p: POI): SelectedBillboard {
  return {
    id: p.id, nom: p.nom ?? 'Panneau', lat: p.lat, lng: p.lng,
    format: p.sous_categorie ?? undefined, score: p.score_ooh ?? null,
    audience: p.audience ?? null, rank: p.rank ?? null, regie: p.adresse ?? undefined,
  };
}

/** Le panneau d'un CERCLE cliqué, depuis les propriétés de l'entité (`useMapInit.ts:300-322`) ; `null` sans position. */
export function panneauDeProprietes(p: Record<string, unknown>, repli: { lat: number; lng: number }): SelectedBillboard | null {
  const lat = Number(p['lat'] ?? repli.lat);
  const lng = Number(p['lng'] ?? repli.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const nombre = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const texte = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return {
    id: String(p['id'] ?? p['nom'] ?? 'panneau'),
    nom: texte(p['nom']) ?? 'Panneau',
    lat, lng,
    format: texte(p['format']) ?? texte(p['sous_categorie']),
    score: nombre(p['score_ooh']),
    audience: nombre(p['audience']),
    rank: nombre(p['rank']),
    regie: texte(p['regie']) ?? texte(p['adresse']),
  };
}

/**
 * La popup d'un MARQUEUR (`useMapMarkers.ts:197-208`), construite par `textContent` : rang, nom, catégorie dans la
 * couleur de l'épingle, sous-catégorie, audience, adresse. Le rang (outil du copilote) prend `--warning` et non
 * l'ambre `#f59e0b` écrit en dur.
 */
export function contenuPopupMarqueur(p: POI, couleur: string, doc: Document): HTMLElement {
  const racine = doc.createElement('div');
  Object.assign(racine.style, { fontSize: '12px', padding: '6px 8px', color: 'var(--text-secondary)' });
  if (p.rank) {
    racine.append(elementTexte(doc, 'span', { color: 'var(--warning)', fontWeight: '700', fontSize: '13px' }, `#${p.rank}`), doc.createTextNode(' '));
  }
  racine.append(elementTexte(doc, 'strong', { color: 'var(--text-primary)', fontSize: '13px' }, p.nom || 'POI'), doc.createElement('br'));
  racine.append(elementTexte(doc, 'span', { color: couleur, fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }, p.categorie));
  if (p.sous_categorie) {
    racine.append(doc.createTextNode(' '), elementTexte(doc, 'span', { color: 'var(--text-tertiary)', fontSize: '11px' }, `· ${p.sous_categorie}`));
  }
  if (p.audience != null) {
    racine.append(doc.createElement('br'), elementTexte(doc, 'span', {
      color: 'var(--success)', fontSize: '12px', fontWeight: '600',
    }, `+${Number(p.audience).toLocaleString('fr-FR')} pers.`));
  }
  if (p.adresse) {
    racine.append(doc.createElement('br'), elementTexte(doc, 'span', { color: 'var(--text-tertiary)', fontSize: '11px' }, p.adresse));
  }
  return racine;
}

/**
 * La popup d'un CERCLE (`useMapInit.ts:329-338`) : nom, catégorie dans sa couleur, sous-catégorie, adresse. Les gris
 * `#94a3b8` / `#64748b` de React deviennent `--text-tertiary` (ils ne suivaient pas le thème).
 */
export function contenuPopupCercle(p: Record<string, unknown>, doc: Document): HTMLElement {
  const racine = doc.createElement('div');
  Object.assign(racine.style, { fontSize: '12px', padding: '6px 8px' });
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  racine.append(elementTexte(doc, 'strong', {}, s(p['nom']) || 'POI'), doc.createElement('br'));
  racine.append(elementTexte(doc, 'span', {
    color: s(p['color']) || COULEUR_CERCLE_DEFAUT, fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
  }, s(p['categorie'])));
  if (p['sous_categorie']) {
    racine.append(doc.createTextNode(' '), elementTexte(doc, 'span', { color: 'var(--text-tertiary)', fontSize: '11px' }, `· ${s(p['sous_categorie'])}`));
  }
  if (p['adresse']) {
    racine.append(doc.createElement('br'), elementTexte(doc, 'span', { color: 'var(--text-tertiary)', fontSize: '11px' }, `📍 ${s(p['adresse'])}`));
  }
  return racine;
}

/**
 * L'élément d'un marqueur DOM (`useMapMarkers.ts:188-196`), créé avec le document de la CARTE. Le cerne est le jeton
 * `--poi-contour` (blanc invariant, comme React) ; l'ombre portée de React est retirée (« flat total », précédent T7).
 */
export function elementMarqueur(doc: Document, couleur: string, taillePx: number, rang: number | null | undefined): HTMLElement {
  const el = doc.createElement('div');
  el.setAttribute('data-marqueur-poi', '');
  if (rang) {
    Object.assign(el.style, {
      width: '22px', height: '22px', background: couleur, borderRadius: '50%', cursor: 'pointer',
      border: '2px solid color-mix(in srgb, var(--poi-contour) 95%, transparent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--poi-contour)',
      fontSize: '11px', fontWeight: '700', fontFamily: 'system-ui,sans-serif',
    });
    el.textContent = String(rang);
  } else {
    Object.assign(el.style, {
      width: `${taillePx}px`, height: `${taillePx}px`, background: couleur, borderRadius: '50%', cursor: 'pointer',
      border: '2px solid color-mix(in srgb, var(--poi-contour) 90%, transparent)',
    });
  }
  return el;
}

/** Le marqueur de la « ville » (centroïde de la zone, `useMapMarkers.ts:236-238`). */
export function elementVille(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.setAttribute('data-marqueur-ville', '');
  Object.assign(el.style, {
    width: '10px', height: '10px', background: 'var(--brand-teal)', border: '2px solid var(--poi-contour)', borderRadius: '2px',
  });
  return el;
}

/** Le cadrage d'une zone (`useMapMarkers.ts:240-252`) : l'emprise de ses POI, ou un vol vers son centre. */
export type Cadrage =
  | { type: 'emprise'; cadre: [[number, number], [number, number]]; maxZoom: number }
  | { type: 'vol'; centre: [number, number]; zoom: number };

export function cadrageDe(zone: ZoneData, mode: 'densite' | 'couches' | 'marqueurs'): Cadrage {
  if (zone.pois.length > 1) {
    const lats = zone.pois.map((p) => p.lat);
    const lngs = zone.pois.map((p) => p.lng);
    return {
      type: 'emprise',
      cadre: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      maxZoom: mode === 'couches' ? 7 : 14,
    };
  }
  const r = zone.rayon_metres;
  const rPoi = zone.rayon_poi_metres;
  let zoom = 12;
  if (rPoi) zoom = rPoi < 300 ? 15 : rPoi < 800 ? 14 : rPoi < 2000 ? 13 : 12;
  else if (r) zoom = r < 1500 ? 14 : r < 4000 ? 13 : 11;
  return { type: 'vol', centre: [zone.coordonnees.lng, zone.coordonnees.lat], zoom };
}

/**
 * Le canevas des rayons autour de chaque POI (`drawPOICirclesOnCanvas`, `useMapInit.ts:42-82`) — redessiné au
 * `moveend`, au `zoomend` et au premier `idle`, jamais à chaque image. Vide sans `rayon_poi_metres`.
 */
export function dessinerRayons(
  carte: Pick<maplibregl.Map, 'project' | 'getZoom'>, zone: ZoneData | null, canevas: HTMLCanvasElement, conteneur: HTMLElement,
): void {
  const w = conteneur.clientWidth;
  const h = conteneur.clientHeight;
  if (canevas.width !== w) canevas.width = w;
  if (canevas.height !== h) canevas.height = h;
  // Un canevas jamais dessiné et sans rayon à dessiner n'a rien à effacer : pas de contexte demandé.
  const aDessiner = !!zone?.rayon_poi_metres && zone.pois.length > 0;
  if (!aDessiner && canevas.dataset['dessine'] !== '1') return;
  const ctx = canevas.getContext?.('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  canevas.dataset['dessine'] = aDessiner ? '1' : '0';
  if (!zone?.rayon_poi_metres || !aDessiner) return;
  const rM = zone.rayon_poi_metres;
  for (const p of zone.pois) {
    if (p.lat == null || p.lng == null) continue;
    try {
      const pt = carte.project([p.lng, p.lat]);
      const metresParPx = (156543.03 * Math.cos((p.lat * Math.PI) / 180)) / Math.pow(2, carte.getZoom());
      const rPx = rM / metresParPx;
      if (rPx < 1) continue;
      const couleur = zone.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rPx, 0, 2 * Math.PI);
      ctx.fillStyle = `${couleur}1e`;
      ctx.fill();
      ctx.strokeStyle = couleur;
      ctx.lineWidth = 2;
      ctx.stroke();
    } catch { /* projection hors vue */ }
  }
}
