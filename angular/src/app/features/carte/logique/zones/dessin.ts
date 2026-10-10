/**
 * Logique PURE du tracé libre (lot 4, T16) — l'outil maison qui remplace `terra-draw` (`DessinLibre.tsx`, arbitrage
 * B8 : aucune nouvelle dépendance). Aucune dépendance Angular ni MapLibre : `couches/dessin.service.ts` traduit les
 * événements de la carte en appels à ces fonctions et peint ce que `apercuTrace` rend.
 *
 * ── LES GESTES ───────────────────────────────────────────────────────────
 * - polygone : un clic = un sommet ; double-clic, ou clic à moins de `SEUIL_FERMETURE_PX` du PREMIER sommet = fermer
 *   (au moins trois sommets) ; `Backspace` retire le dernier sommet du tracé en cours.
 * - rectangle : deux clics aux coins opposés.
 *
 * Un double-clic émet d'abord deux `click` au même endroit : un clic à moins du seuil du DERNIER sommet est donc
 * ignoré — sans quoi chaque double-clic ajouterait deux sommets confondus, et la base recevrait un anneau dégénéré.
 *
 * Le tracé n'est NI validé NI réparé ici : `/api/custom-geo/source/dessin` le passe à `ST_MakeValid` et dit s'il l'a
 * corrigé (`corrige`). Le réparer côté client rendrait une géométrie DIFFÉRENTE de celle que la base enregistre.
 */

export type ModeDessin = 'polygone' | 'rectangle';
/** `[longitude, latitude]`. */
export type Position = [number, number];
export interface Pixel { x: number; y: number }
/** Projection d'une position en pixels d'écran (`maplibregl.Map.project`), fournie par l'appelant. */
export type Projeter = (p: Position) => Pixel;

/** Rayon, en pixels, sous lequel un clic « touche » un sommet existant. */
export const SEUIL_FERMETURE_PX = 8;

export interface EtatTrace {
  readonly mode: ModeDessin;
  /** Sommets du tracé EN COURS, dans l'ordre de pose. */
  readonly sommets: readonly Position[];
  /** Le tracé FINI (anneau fermé), `null` tant qu'il ne l'est pas. */
  readonly ferme: GeoJSON.Polygon | null;
}

export function traceVide(mode: ModeDessin): EtatTrace {
  return { mode, sommets: [], ferme: null };
}

const distance = (a: Pixel, b: Pixel) => Math.hypot(a.x - b.x, a.y - b.y);
const touche = (pixel: Pixel, p: Position | undefined, projeter: Projeter) =>
  p !== undefined && distance(pixel, projeter(p)) < SEUIL_FERMETURE_PX;

function fermer(mode: ModeDessin, anneau: Position[]): EtatTrace {
  return { mode, sommets: [], ferme: { type: 'Polygon', coordinates: [anneau] } };
}

/** L'anneau d'un rectangle à partir de deux coins opposés : 5 positions, dans le sens de la pose. */
function anneauRectangle(a: Position, b: Position): Position[] {
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
}

/** Un clic sur la carte. Après un tracé fermé, il en commence un NOUVEAU : une zone = une géométrie. */
export function cliquer(etat: EtatTrace, position: Position, pixel: Pixel, projeter: Projeter): EtatTrace {
  // Le second `click` d'un double-clic qui vient de fermer le tracé (sur le premier sommet, ou sur le second coin d'un
  // rectangle) tombe sur un sommet de l'anneau : il ne doit pas en commencer un nouveau, qui effacerait le tracé fermé.
  if (etat.ferme?.coordinates[0].some((p) => touche(pixel, p as Position, projeter))) return etat;
  const sommets = etat.ferme ? [] : etat.sommets;
  if (etat.mode === 'rectangle') {
    if (sommets.length === 0) return { mode: etat.mode, sommets: [position], ferme: null };
    // Second clic sur le premier coin : un rectangle sans surface, on attend un vrai coin opposé.
    if (touche(pixel, sommets[0], projeter)) return etat;
    return fermer(etat.mode, anneauRectangle(sommets[0], position));
  }
  if (sommets.length >= 3 && touche(pixel, sommets[0], projeter)) return fermer(etat.mode, [...sommets, sommets[0]]);
  if (touche(pixel, sommets.at(-1), projeter)) return etat;
  return { mode: etat.mode, sommets: [...sommets, position], ferme: null };
}

/** Double-clic : ferme le polygone en cours s'il a au moins trois sommets. */
export function doubleCliquer(etat: EtatTrace): EtatTrace {
  if (etat.mode !== 'polygone' || etat.ferme || etat.sommets.length < 3) return etat;
  return fermer(etat.mode, [...etat.sommets, etat.sommets[0]]);
}

/** `Backspace` : retire le dernier sommet du tracé en cours ; un tracé fermé ou vide reste tel quel. */
export function retirerDernier(etat: EtatTrace): EtatTrace {
  if (etat.ferme || etat.sommets.length === 0) return etat;
  return { ...etat, sommets: etat.sommets.slice(0, -1) };
}

/** Le compte affiché sous les boutons de mode : sommets du tracé fini (sans la fermeture) ou en cours. */
export function nombreSommets(etat: EtatTrace): number {
  return etat.ferme ? Math.max(0, etat.ferme.coordinates[0].length - 1) : etat.sommets.length;
}

/** Ce que la carte peint : le polygone fini, ou la ligne élastique jusqu'au curseur et les sommets posés. */
export function apercuTrace(etat: EtatTrace, curseur: Position | null): GeoJSON.FeatureCollection {
  const entite = (geometry: GeoJSON.Geometry): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry });
  if (etat.ferme) return { type: 'FeatureCollection', features: [entite(etat.ferme)] };
  const features: GeoJSON.Feature[] = [];
  const [premier] = etat.sommets;
  if (etat.mode === 'rectangle' && premier && curseur) {
    features.push(entite({ type: 'Polygon', coordinates: [anneauRectangle(premier, curseur)] }));
  } else if (etat.sommets.length > 0) {
    const ligne = curseur ? [...etat.sommets, curseur] : [...etat.sommets];
    if (ligne.length >= 2) features.push(entite({ type: 'LineString', coordinates: ligne }));
  }
  for (const s of etat.sommets) features.push(entite({ type: 'Point', coordinates: s }));
  return { type: 'FeatureCollection', features };
}

/**
 * La ligne d'aide sous les boutons de mode — textes de `DessinLibre.tsx:197-201`, sauf le rectangle : React annonçait
 * « Cliquez-glissez », geste que `terra-draw` ne faisait pas (deux clics) ; le texte décrit ici le geste réel.
 */
export function messageAideDessin(mode: ModeDessin, n: number): string {
  if (n > 0) return `${n} sommet${n > 1 ? 's' : ''} tracé${n > 1 ? 's' : ''}`;
  return mode === 'rectangle'
    ? 'Cliquez deux coins opposés pour tracer un rectangle'
    : 'Cliquez pour poser les sommets, double-clic pour fermer';
}
