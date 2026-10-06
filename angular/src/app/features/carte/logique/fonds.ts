/**
 * Copie Angular (lot 4, P6) VERBATIM de `app/copilote/_lib/constants.ts:131-145` (fonds de
 * carte), verrouillee par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 *
 * Map style — OpenFreeMap Liberty (vecteur, gratuit, sans API key, labels FR).
 * Defaut React conserve : « MAGELIAN » et « Clair » pointent sur la MEME URL (positron).
 */

export const MAP_STYLES = [
  { id: 'liberty',  label: 'Standard',  url: 'https://tiles.openfreemap.org/styles/liberty'  },
  { id: 'bright',   label: 'OSM',       url: 'https://tiles.openfreemap.org/styles/bright'   },
  { id: 'positron', label: 'Clair',     url: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'magelian', label: 'MAGELIAN',  url: 'https://tiles.openfreemap.org/styles/positron' },
] as const;

export const MAP_STYLE = MAP_STYLES[0].url;
