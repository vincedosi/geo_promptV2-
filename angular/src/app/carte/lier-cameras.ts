import type maplibregl from 'maplibre-gl';

export type CarteLiable = Pick<maplibregl.Map, 'on' | 'off' | 'jumpTo' | 'getCenter' | 'getZoom' | 'getBearing' | 'getPitch'>;

/**
 * Deux cartes qui regardent le même endroit (portée de VueCartesZones.tsx).
 *
 * - Un VERROU de réentrance : placer B émet `move` sur B, qui replacerait A,
 *   qui émettrait `move`… Sans lui, les deux cartes tremblent.
 * - `jumpTo` et jamais `easeTo` : une animation ferait arriver la carte liée
 *   APRÈS celle qu'on manipule.
 */
export function lierCameras(a: CarteLiable, b: CarteLiable): () => void {
  let enCours = false;
  const suivre = (source: CarteLiable, cible: CarteLiable) => () => {
    if (enCours) return;
    enCours = true;
    try {
      cible.jumpTo({
        center: source.getCenter(),
        zoom: source.getZoom(),
        bearing: source.getBearing(),
        pitch: source.getPitch(),
      });
    } finally {
      enCours = false;
    }
  };
  const aVersB = suivre(a, b);
  const bVersA = suivre(b, a);
  a.on('move', aVersB);
  b.on('move', bVersA);
  aVersB();
  return () => {
    a.off('move', aVersB);
    b.off('move', bVersA);
  };
}
