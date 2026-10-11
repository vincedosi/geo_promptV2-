import type maplibregl from 'maplibre-gl';
import { elementTexte } from '../../../carte/contenu-popup';
import { avantDe } from '../logique/ordre-couches';
import { couleurBadge } from '../logique/clustering/panneau';

export const SOURCE_CLUSTERS = 'clusters-source';
export const COUCHE_CLUSTERS = 'clusters-layer';

/** Une collection vide : la source vidée par « Tout effacer » (`page.tsx:696`). */
export const COLLECTION_VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type CarteClusters = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer'>;

/**
 * La source et la couche des clusters (`useMapInit.ts:762-780`), IDEMPOTENTES, insérées à leur place dans l'ordre de
 * React (`avantDe`) — masquées : la visibilité est l'affaire d'un effet À PART (une bascule ne rejoue pas les données).
 * La teinte de chaque point est sa DONNÉE (`['get', 'cluster_color']`, posée par la route) ; seul le cerne est un jeton
 * (`--poi-contour`, le `#ffffff` invariant de React), lu par `CouleursService`.
 */
export function poserCoucheClusters(carte: CarteClusters, contour: string): void {
  if (!carte.getSource(SOURCE_CLUSTERS)) {
    carte.addSource(SOURCE_CLUSTERS, { type: 'geojson', data: COLLECTION_VIDE, generateId: true });
  }
  if (!carte.getLayer(COUCHE_CLUSTERS)) {
    carte.addLayer({
      id: COUCHE_CLUSTERS, type: 'circle', source: SOURCE_CLUSTERS,
      paint: {
        'circle-color': ['get', 'cluster_color'],
        'circle-radius': 7,
        'circle-stroke-width': 2,
        'circle-stroke-color': contour,
        'circle-opacity': 0.92,
      },
      layout: { visibility: 'none' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_CLUSTERS));
  }
}

/**
 * Le contenu de la bulle d'un point (`useMapInit.ts:808-826`) : nom, pastille du cluster, ville. Construit par
 * `textContent` — `poi_name` et `ville` viennent d'imports CSV/XLSX : jamais d'`innerHTML` (la XSS que React a fermée).
 * La pastille n'accepte qu'un hexadécimal (`couleurBadge`). Les gris ardoise de React deviennent des jetons.
 */
export function contenuPopupCluster(p: Readonly<Record<string, unknown>>, doc: Document): HTMLElement {
  const racine = elementTexte(doc, 'div', { fontSize: '12px', padding: '6px 8px', fontFamily: 'var(--font-sans)' });
  racine.appendChild(elementTexte(doc, 'div', { fontWeight: '700', color: 'var(--text-primary)' }, String(p['poi_name'] ?? '') || '—'));
  racine.appendChild(elementTexte(doc, 'span', {
    display: 'inline-block', marginTop: '3px', padding: '1px 6px', borderRadius: '2px', fontSize: '10px',
    background: couleurBadge(p['cluster_color']), color: 'var(--poi-contour)',
  }, String(p['cluster_label'] ?? '')));
  racine.appendChild(elementTexte(doc, 'div', { color: 'var(--text-tertiary)', fontSize: '10px', marginTop: '3px' }, String(p['ville'] ?? '')));
  return racine;
}
