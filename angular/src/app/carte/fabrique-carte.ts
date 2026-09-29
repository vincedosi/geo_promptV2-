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
