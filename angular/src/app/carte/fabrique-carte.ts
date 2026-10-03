import { InjectionToken } from '@angular/core';
import maplibregl from 'maplibre-gl';

/** Le fond du module risque, dans les DEUX thèmes (inventaire du 2026-09-29). */
export const FOND_POSITRON = 'https://tiles.openfreemap.org/styles/positron';

export type FabriqueCarte = (options: maplibregl.MapOptions) => maplibregl.Map;

/**
 * Qui crée la carte. Un jeton plutôt qu'un `new maplibregl.Map` en dur :
 * l'environnement de test n'a pas de WebGL, et les tests fournissent une
 * carte factice (`testing/carte-factice.ts`).
 */
export const FABRIQUE_CARTE = new InjectionToken<FabriqueCarte>('FABRIQUE_CARTE', {
  providedIn: 'root',
  factory: () => (options) => new maplibregl.Map(options),
});

/** Ce qu'une popup de carte doit savoir faire ici : la surface de `maplibregl.Popup` employée par le projet. */
export interface PopupCarte {
  setLngLat(lngLat: maplibregl.LngLatLike): PopupCarte;
  setDOMContent(contenu: Node): PopupCarte;
  addTo(carte: maplibregl.Map): PopupCarte;
}

export type FabriquePopup = (options: maplibregl.PopupOptions) => PopupCarte;

/**
 * Qui crée une popup. Même raison que `FABRIQUE_CARTE` : sans WebGL, les tests fournissent une popup factice et
 * relisent son contenu. La popup vit DANS le conteneur de la carte, donc dans la racine d'ombre (jamais un portail).
 */
export const FABRIQUE_POPUP = new InjectionToken<FabriquePopup>('FABRIQUE_POPUP', {
  providedIn: 'root',
  factory: () => (options) => new maplibregl.Popup(options),
});
