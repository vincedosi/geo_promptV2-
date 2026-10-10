import { HttpErrorResponse } from '@angular/common/http';
import type maplibregl from 'maplibre-gl';
import { messageErreurApi } from '../../../core/http/erreurs';
import { avantDe } from '../logique/ordre-couches';
import { buildColorExpression } from '../logique/meteo/palettes';
import type { MeteoZoneMeta, MeteoZoneValue } from '../logique/meteo/types';
import { OPACITE_METEO, TRAIT_METEO } from '../logique/palettes-donnees-carte';

/**
 * La couche « Météo », en fonctions PURES (patron `couche-radio.ts`, `couche-civique.ts`) : pose de la source et de ses
 * deux couches (`useMapInit.ts:362-383`), synchronisation des valeurs (`useMeteoLayer.ts:46-86`), popup d'une zone
 * (`useMeteoLayer.ts:88-122`) et libellé d'une erreur de lecture. L'état et les effets vivent dans `MeteoService`.
 */

export const SOURCE_METEO = 'meteo-source';
export const COUCHE_METEO_FOND = 'meteo-fill';
export const COUCHE_METEO_TRAIT = 'meteo-outline';

/** Ce qu'une lecture réussie affiche : les valeurs, leurs métadonnées et les polygones de LEUR échelle, ensemble. */
export interface AffichageMeteo {
  donnees: Record<string, MeteoZoneValue>;
  meta: MeteoZoneMeta;
  zones: GeoJSON.FeatureCollection;
}

type CarteMeteo = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setLayoutProperty' | 'setPaintProperty'>;

/** Échec des contours (`/api/meteo-geo/zones`) : sans polygones, rien ne peut être peint. */
export const MESSAGE_CONTOURS_INDISPONIBLES = 'Contours des zones indisponibles — réessayez dans quelques instants.';

/** `HTTP <statut> <message de la route>` (statut 0 : `messageErreurApi`) ; le message d'une ligne `error` ; sinon « Erreur inconnue ». */
export function messageErreurMeteo(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    // Réseau coupé : le message commun de l'application (`messageErreurApi`), jamais « HTTP 0 ».
    if (e.status === 0) return messageErreurApi(e);
    const texte = typeof e.error === 'string' ? e.error : '';
    let message = texte;
    try {
      const corps = JSON.parse(texte) as { error?: unknown };
      if (typeof corps.error === 'string') message = corps.error;
    } catch { /* corps non JSON : gardé tel quel, comme React */ }
    return `HTTP ${e.status} ${message}`.trim();
  }
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

/** La rampe de la variable sur `weather_value` (`buildColorExpression`, B12). */
export function expressionMeteo(meta: MeteoZoneMeta): unknown[] {
  return buildColorExpression(meta.variable, meta.stats, 'weather_value');
}

/**
 * La source vide et ses deux couches masquées (`useMapInit.ts:364-383`), IDEMPOTENT, à leur place (`avantDe`). L'aplat
 * naît avec la rampe de la variable affichée : le `#4ecdc4` de React n'était qu'une valeur de départ, aussitôt remplacée.
 */
export function poserCoucheMeteo(carte: CarteMeteo, teinte: unknown[]): void {
  if (!carte.getSource(SOURCE_METEO)) {
    carte.addSource(SOURCE_METEO, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!carte.getLayer(COUCHE_METEO_FOND)) {
    carte.addLayer({
      id: COUCHE_METEO_FOND, type: 'fill', source: SOURCE_METEO,
      paint: { 'fill-color': teinte, 'fill-opacity': OPACITE_METEO },
      layout: { visibility: 'none' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_METEO_FOND));
  }
  if (!carte.getLayer(COUCHE_METEO_TRAIT)) {
    carte.addLayer({
      id: COUCHE_METEO_TRAIT, type: 'line', source: SOURCE_METEO,
      paint: { 'line-color': TRAIT_METEO.couleur, 'line-width': TRAIT_METEO.largeur },
      layout: { visibility: 'none' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_METEO_TRAIT));
  }
}

/** `useMeteoLayer.ts:46-86` : seules les zones qui ont une valeur, la rampe de la variable, la visibilité. */
export function synchroniserCoucheMeteo(carte: CarteMeteo, a: AffichageMeteo | null, visible: boolean): void {
  const source = carte.getSource(SOURCE_METEO) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const montrer = (v: boolean) => {
    for (const c of [COUCHE_METEO_FOND, COUCHE_METEO_TRAIT]) {
      if (carte.getLayer(c)) carte.setLayoutProperty(c, 'visibility', v ? 'visible' : 'none');
    }
  };
  if (!a) {
    source.setData({ type: 'FeatureCollection', features: [] });
    montrer(false);
    return;
  }
  const features: GeoJSON.Feature[] = [];
  for (const f of a.zones.features) {
    const v = a.donnees[String(f.properties?.['code'] ?? '')];
    if (!v) continue;
    features.push({ ...f, properties: { ...f.properties, weather_value: v.value, label: v.label, unit: v.unit } });
  }
  source.setData({ type: 'FeatureCollection', features });
  if (carte.getLayer(COUCHE_METEO_FOND)) {
    carte.setPaintProperty(COUCHE_METEO_FOND, 'fill-color', expressionMeteo(a.meta));
  }
  montrer(visible);
}

/** Nom, valeur (`fr-FR`, une décimale au plus) et unité, libellé qualitatif (`useMeteoLayer.ts:98-108`), en DOM. */
export function contenuPopupMeteo(p: Record<string, unknown>, doc: Document): HTMLElement {
  const racine = doc.createElement('div');
  racine.setAttribute('data-popup-meteo', '');
  Object.assign(racine.style, { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'var(--text-primary)' });
  const nom = doc.createElement('div');
  nom.textContent = p['nom'] != null ? String(p['nom']) : '';
  Object.assign(nom.style, { fontWeight: '500', marginBottom: '2px' });
  racine.append(nom);
  const valeur = p['weather_value'] != null ? Number(p['weather_value']) : null;
  if (valeur != null) {
    const ligne = doc.createElement('div');
    ligne.textContent = `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${p['unit'] != null ? String(p['unit']) : ''}`;
    Object.assign(ligne.style, { fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' });
    racine.append(ligne);
  }
  if (p['label']) {
    const libelle = doc.createElement('div');
    libelle.textContent = String(p['label']);
    Object.assign(libelle.style, { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' });
    racine.append(libelle);
  }
  return racine;
}
