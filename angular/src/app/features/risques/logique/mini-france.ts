/**
 * Projection et cadrage de la mini-carte de l'étape ③ — copie de `components/risques/CarteMiniFrance.tsx:67-78` et
 * `:112-117`, `:137-299` (gel P5 du module risque React) ; parité : `mini-france.spec.ts`, dont les valeurs attendues
 * ont été produites UNE fois par la version React (les fonctions n'y sont pas exportées, et le gel interdit de les
 * exporter).
 *
 * ── POURQUOI DU SVG ET PAS MAPLIBRE (repris de React) ─────────────────────
 *
 * Il n'y a rien à naviguer : une vue fixe, 104 départements ou 18 régions. Une instance MapLibre coûterait un canvas
 * WebGL, un style et un cycle de vie, pour un résultat moins net qu'un tracé vectoriel. Et cette carte n'entre PAS au
 * registre des dégradés : elle n'éteint rien de la carte permanente.
 */

/**
 * Une géométrie GeoJSON telle que `get_zone_polygons` la rend.
 *
 * ⚠ `GeometryCollection` n'est PAS un cas exotique : 66 des 104 départements en sont une (mesuré le 2026-09-18).
 * L'ignorer ne lève rien, le département disparaît du tracé et laisse voir le fond — indiscernable d'une unité sans
 * donnée.
 */
export type GeometrieZone =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'GeometryCollection'; geometries: GeometrieZone[] };

export interface ZoneGeo {
  type: 'Feature';
  properties: { code: string; nom: string };
  geometry: GeometrieZone;
}

export interface Boite { x: number; y: number; w: number; h: number }
export interface Cadre { ouest: number; est: number; sud: number; nord: number }
export type Projection = (lon: number, lat: number) => [number, number];

export const LARGEUR = 300;
export const HAUTEUR = 300;
/** Cinq classes : au-delà, l'œil ne distingue plus deux paliers voisins. */
export const N_CLASSES = 5;
/** Côté d'un cartouche d'outre-mer, en unités du viewBox. */
export const COTE_OM = 30;

/**
 * Mercator sphérique. ⚠ LES DEUX AXES DANS LA MÊME UNITÉ (radians) : en degrés pour x et sans dimension pour y,
 * l'échelle commune était imposée par la longitude et la France tenait dans 5 pixels de haut.
 */
export function mercatorX(lon: number): number {
  return (lon * Math.PI) / 180;
}

export function mercatorY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
}

/** Projette un cadre dans une boîte en CONSERVANT les proportions (une île n'y paraît pas plus grande). */
export function projecteur(cadre: Cadre, boite: Boite): Projection {
  const xOuest = mercatorX(cadre.ouest);
  const xEst = mercatorX(cadre.est);
  const ySud = mercatorY(cadre.sud);
  const yNord = mercatorY(cadre.nord);
  const dX = xEst - xOuest || 1e-9;
  const dY = yNord - ySud || 1e-9;
  const echelle = Math.min(boite.w / dX, boite.h / dY);
  const largeurUtile = dX * echelle;
  const hauteurUtile = dY * echelle;
  const dx = boite.x + (boite.w - largeurUtile) / 2;
  const dy = boite.y + (boite.h - hauteurUtile) / 2;
  return (lon: number, lat: number): [number, number] => [
    dx + (mercatorX(lon) - xOuest) * echelle,
    dy + hauteurUtile - (mercatorY(lat) - ySud) * echelle,
  ];
}

/** Tous les anneaux d'une géométrie, collections comprises. */
function anneaux(g: GeometrieZone | null | undefined): number[][][] {
  if (!g) return [];
  if (g.type === 'GeometryCollection') {
    return Array.isArray(g.geometries) ? g.geometries.flatMap(anneaux) : [];
  }
  if (!Array.isArray(g.coordinates)) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!Array.isArray(polys)) return [];
  const out: number[][][] = [];
  for (const p of polys) {
    if (!Array.isArray(p)) continue;
    for (const a of p) if (Array.isArray(a) && a.length >= 3) out.push(a);
  }
  return out;
}

/** Cadre englobant d'un lot de zones. `null` si aucune géométrie exploitable. */
export function cadreDe(zones: ZoneGeo[]): Cadre | null {
  let ouest = Infinity, est = -Infinity, sud = Infinity, nord = -Infinity;
  for (const z of zones) {
    for (const a of anneaux(z.geometry)) {
      for (const paire of a) {
        const lon = paire[0], lat = paire[1];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (lon < ouest) ouest = lon;
        if (lon > est) est = lon;
        if (lat < sud) sud = lat;
        if (lat > nord) nord = lat;
      }
    }
  }
  return Number.isFinite(ouest) ? { ouest, est, sud, nord } : null;
}

/**
 * Élargit un cadre d'une marge relative — le `padding` d'un `fitBounds`. Un PLANCHER de 0,05° complète la marge :
 * une unité minuscule donnerait sinon un facteur d'échelle immense.
 */
export function elargir(c: Cadre, part: number): Cadre {
  const mx = Math.max((c.est - c.ouest) * part, 0.05);
  const my = Math.max((c.nord - c.sud) * part, 0.05);
  return { ouest: c.ouest - mx, est: c.est + mx, sud: c.sud - my, nord: c.nord + my };
}

/** Le tracé SVG d'une zone (un sous-chemin fermé par anneau, une décimale). */
export function chemin(z: ZoneGeo, proj: Projection): string {
  const morceaux: string[] = [];
  for (const a of anneaux(z.geometry)) {
    const pts = a.map((p) => proj(p[0], p[1]));
    morceaux.push(`M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`);
  }
  return morceaux.join('');
}

/** Centre du cadre englobant — suffisant pour poser un cercle sur une vignette. */
export function centreDe(z: ZoneGeo, proj: Projection): [number, number] | null {
  const c = cadreDe([z]);
  if (!c) return null;
  return proj((c.ouest + c.est) / 2, (c.sud + c.nord) / 2);
}

/**
 * Sépare la métropole des territoires lointains — par la GÉOGRAPHIE, pas par le code : à la maille région, la
 * Guadeloupe, la Martinique, la Guyane, La Réunion et Mayotte portent 01, 02, 03, 04 et 06, indiscernables de codes
 * métropolitains. Médiane des centres, puis écart de plus de `ECART_LOINTAIN` degrés.
 */
const ECART_LOINTAIN = 20;

function mediane(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
}

export function separerLointains(zones: ZoneGeo[]): { principal: ZoneGeo[]; lointains: ZoneGeo[] } {
  const centres = new Map<string, [number, number]>();
  for (const z of zones) {
    const c = cadreDe([z]);
    if (c) centres.set(z.properties.code, [(c.ouest + c.est) / 2, (c.sud + c.nord) / 2]);
  }
  const vals = [...centres.values()];
  if (vals.length === 0) return { principal: zones, lointains: [] };
  const mLon = mediane(vals.map((v) => v[0]));
  const mLat = mediane(vals.map((v) => v[1]));

  const principal: ZoneGeo[] = [];
  const lointains: ZoneGeo[] = [];
  for (const z of zones) {
    const c = centres.get(z.properties.code);
    const loin = c !== undefined
      && (Math.abs(c[0] - mLon) > ECART_LOINTAIN || Math.abs(c[1] - mLat) > ECART_LOINTAIN);
    (loin ? lointains : principal).push(z);
  }
  return { principal, lointains };
}
