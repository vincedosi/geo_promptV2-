import type maplibregl from 'maplibre-gl';
import { elementTexte } from '../../../carte/contenu-popup';
import type { ScoreCP } from '../logique/analyses/score';
import { avantDe } from '../logique/ordre-couches';
import { OPACITE_SCORE, PALIERS_SCORE, SANTE_TRANSPARENT, TRAIT_SCORE } from '../logique/palettes-donnees-carte';

/**
 * La couche « Score composite », en fonctions PURES (patron `couche-meteo.ts`) : fusion des scores dans les contours
 * des codes postaux, pose et retrait de la source et de ses deux couches, popup d'un code postal
 * (`ScoreMapLayer.tsx:81-104, 163-227`). L'état et les effets vivent dans `ScoreService`.
 */

export const SOURCE_SCORE = 'score-composite-cp';
export const COUCHE_SCORE_FOND = 'score-composite-cp-fill';
export const COUCHE_SCORE_TRAIT = 'score-composite-cp-line';

/** Ce que la carte peint : les scores, ce qu'ils agrègent (la légende), le nombre d'indicateurs DEMANDÉS. */
export interface ScoreAffiche {
  scores: readonly ScoreCP[];
  libelle: string;
  nIndicateurs: number;
}

type CarteScore = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'removeSource' | 'getLayer' | 'addLayer' | 'removeLayer' | 'setPaintProperty'>;

/**
 * L'aplat 0-100 (`echelleScore`) : un score absent (-1) reste transparent ; sinon l'interpolation des paliers, le teal
 * PLEIN à 100. Le score est déjà normalisé sur le périmètre : ni bornes ni log10, contrairement aux carreaux.
 */
export function expressionScore(teal: string): unknown[] {
  const v = ['coalesce', ['get', 'score'], -1];
  return ['case', ['<', v, 0], SANTE_TRANSPARENT, ['interpolate', ['linear'], v, ...PALIERS_SCORE.flat(), 100, teal]];
}

/** Un score PARTIEL est peint en retrait : sa normalisation porte sur une sous-population, il n'est pas comparable. */
const EXPRESSION_OPACITE = ['case', ['==', ['get', 'partiel'], true], OPACITE_SCORE.partiel, OPACITE_SCORE.complet];

/** Les contours des SEULS codes postaux scorés, avec `score`, `n_indicateurs` et `partiel` en propriétés. */
export function entitesScore(zones: GeoJSON.FeatureCollection, a: ScoreAffiche): GeoJSON.FeatureCollection {
  const parCode = new Map(a.scores.map((s) => [s.code, s]));
  const features: GeoJSON.Feature[] = [];
  for (const f of zones.features) {
    const s = parCode.get(String(f.properties?.['code'] ?? ''));
    if (!s) continue;
    features.push({ ...f, properties: { ...f.properties, score: s.score, n_indicateurs: s.n_indicateurs, partiel: s.n_indicateurs < a.nIndicateurs } });
  }
  return { type: 'FeatureCollection', features };
}

/** Le nombre de scores partiels (`ScoreMapLayer.tsx:239`). */
export function comptePartiels(a: ScoreAffiche | null): number {
  return a ? a.scores.filter((s) => s.n_indicateurs < a.nIndicateurs).length : 0;
}

/** Source et couches, IDEMPOTENT, à leur place (`avantDe`) ; les données sont (re)posées à chaque appel. */
export function poserCoucheScore(carte: CarteScore, donnees: GeoJSON.FeatureCollection, teal: string): void {
  const source = carte.getSource(SOURCE_SCORE) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(donnees);
  else carte.addSource(SOURCE_SCORE, { type: 'geojson', data: donnees });
  if (!carte.getLayer(COUCHE_SCORE_FOND)) {
    carte.addLayer({
      id: COUCHE_SCORE_FOND, type: 'fill', source: SOURCE_SCORE,
      paint: { 'fill-color': expressionScore(teal), 'fill-opacity': EXPRESSION_OPACITE },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_SCORE_FOND));
  }
  if (!carte.getLayer(COUCHE_SCORE_TRAIT)) {
    carte.addLayer({
      id: COUCHE_SCORE_TRAIT, type: 'line', source: SOURCE_SCORE,
      paint: { 'line-color': TRAIT_SCORE.couleur, 'line-width': TRAIT_SCORE.largeur },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_SCORE_TRAIT));
  }
}

/** Le teal relu au changement de thème : il est invariant aujourd'hui, mais c'est un jeton — jamais figé. */
export function repeindreCoucheScore(carte: CarteScore, teal: string): void {
  if (carte.getLayer(COUCHE_SCORE_FOND)) carte.setPaintProperty(COUCHE_SCORE_FOND, 'fill-color', expressionScore(teal));
}

/** `nettoyer` de React : couches puis source. */
export function retirerCoucheScore(carte: CarteScore): void {
  if (carte.getLayer(COUCHE_SCORE_TRAIT)) carte.removeLayer(COUCHE_SCORE_TRAIT);
  if (carte.getLayer(COUCHE_SCORE_FOND)) carte.removeLayer(COUCHE_SCORE_FOND);
  if (carte.getSource(SOURCE_SCORE)) carte.removeSource(SOURCE_SCORE);
}

/**
 * Le popup d'un code postal (`ScoreMapLayer.tsx:207-221`), en DOM — jamais du HTML recomposé, le nom vient de la base :
 * « code — nom », le score à une décimale sur 100, « sur N indicateur(s) », et l'avertissement d'un score partiel.
 */
export function contenuPopupScore(p: Record<string, unknown>, doc: Document): HTMLElement {
  const code = String(p['code'] ?? '');
  const nom = String(p['nom'] ?? '');
  const n = Number(p['n_indicateurs'] ?? 0);
  const partiel = Boolean(p['partiel']);
  const racine = elementTexte(doc, 'div', { fontFamily: "'Inter', system-ui, sans-serif", fontSize: '12px', color: 'var(--text-primary)' });
  racine.setAttribute('data-popup-score', '');
  const valeur = elementTexte(doc, 'div', { fontFamily: "'JetBrains Mono', monospace", fontSize: '16px', margin: '4px 0' }, Number(p['score'] ?? 0).toFixed(1));
  valeur.append(elementTexte(doc, 'span', { fontSize: '11px', color: 'var(--text-tertiary)' }, '/100'));
  racine.append(
    elementTexte(doc, 'div', { fontWeight: '500' }, `${code}${nom ? ` — ${nom}` : ''}`),
    valeur,
    elementTexte(
      doc, 'div', { fontSize: '11px', color: partiel ? 'var(--warning)' : 'var(--text-tertiary)' },
      `sur ${n} indicateur${n > 1 ? 's' : ''}${partiel ? ' — partiel, non comparable' : ''}`,
    ),
  );
  return racine;
}
