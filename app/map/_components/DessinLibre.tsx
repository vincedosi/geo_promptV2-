'use client';

/**
 * @file DessinLibre — tracer une zone à la main sur la carte
 * (Tâche 18, 2026-09-13).
 *
 * Deux modes, polygone et rectangle, plus annuler / refaire. Le tracé se ferme
 * automatiquement : `terra-draw` referme un polygone sur son premier sommet
 * dès qu'on double-clique ou qu'on reclique dessus.
 *
 * ── Pourquoi `terra-draw` et pas un tracé maison ──────────────────────────
 * C'est le seul moteur de dessin qui pilote MapLibre 5 nativement
 * (`mapbox-gl-draw` exige un adaptateur non maintenu). Vérifié avant
 * d'installer : `terra-draw` 1.33 et son adaptateur MapLibre 1.4 existent, et
 * la **CSP de `next.config.js` n'a RIEN à ouvrir** — `script-src 'self'`
 * suffit pour une librairie bundlée, elle n'est chargée d'aucun CDN. Le plan
 * demandait de le confirmer plutôt que de le supposer : c'est fait.
 *
 * ── Le composant ne fabrique PAS la géométrie finale ──────────────────────
 * Il rend le tracé brut. La validation, la réparation des auto-intersections
 * et le clip sur le territoire se font en base (`zone_dessin`, sql/156) : un
 * tracé à main levée qui croise son propre chemin produit un « nœud papillon »
 * que `ST_MakeValid` découpe en deux polygones — mesuré, un carré croisé de
 * 163 km² devient deux triangles de 81,62 km². Le faire côté client
 * demanderait d'embarquer une bibliothèque de géométrie, et surtout donnerait
 * un résultat DIFFÉRENT de celui que la base enregistrera.
 *
 * Le composant est chargé en `dynamic(..., { ssr: false })` par son appelant :
 * `terra-draw` touche au DOM et à la carte, il n'a rien à faire côté serveur.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

type ModeDessin = 'polygon' | 'rectangle' | 'select';

export interface DessinLibreProps {
  mapRef: React.MutableRefObject<MaplibreMap | null>;
  /** Remonte le tracé courant (Polygon GeoJSON) ou `null` s'il n'y en a plus. */
  onTrace: (geometry: GeoJSON.Polygon | null) => void;
  /** Arrête le dessin et rend la carte à son usage normal. */
  onFermer: () => void;
}

export function DessinLibre({ mapRef, onTrace, onFermer }: DessinLibreProps) {
  const drawRef = useRef<TerraDraw | null>(null);
  const [mode, setMode] = useState<ModeDessin>('polygon');
  const [nSommets, setNSommets] = useState(0);

  // `onTrace` dans une ref : l'effet d'initialisation ne doit tourner QU'UNE
  // fois, et ne doit pas se relancer parce que l'appelant a recréé sa fonction
  // au rendu suivant — relancer détruirait le tracé en cours.
  const onTraceRef = useRef(onTrace);
  onTraceRef.current = onTrace;

  const remonterTrace = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const traits = draw.getSnapshot().filter((f) => f.geometry?.type === 'Polygon');
    // Le dernier tracé fait foi : dessiner un second polygone remplace le
    // premier plutôt que d'en accumuler, parce qu'une zone = une géométrie.
    const dernier = traits[traits.length - 1];
    const geom = (dernier?.geometry as GeoJSON.Polygon | undefined) ?? null;
    setNSommets(geom ? Math.max(0, (geom.coordinates[0]?.length ?? 1) - 1) : 0);
    onTraceRef.current(geom);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode(),
        new TerraDrawRectangleMode(),
        new TerraDrawSelectMode({
          flags: {
            polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
            rectangle: { feature: { draggable: true, coordinates: { draggable: true } } },
          },
        }),
      ],
    });

    draw.start();
    draw.setMode('polygon');
    drawRef.current = draw;

    draw.on('finish', remonterTrace);
    draw.on('change', remonterTrace);

    return () => {
      draw.off('finish', remonterTrace);
      draw.off('change', remonterTrace);
      try { draw.stop(); } catch { /* la carte a pu partir avant nous */ }
      drawRef.current = null;
      onTraceRef.current(null);
    };
  }, [mapRef, remonterTrace]);

  const changerMode = (m: ModeDessin) => {
    setMode(m);
    drawRef.current?.setMode(m);
  };

  const effacer = () => {
    drawRef.current?.clear();
    setNSommets(0);
    onTraceRef.current(null);
  };

  const boutonMode = (m: ModeDessin, libelle: string) => (
    <button
      key={m}
      type="button"
      onClick={() => changerMode(m)}
      style={{
        flex: 1,
        background: mode === m ? 'rgba(78,205,196,0.1)' : 'transparent',
        border: `0.5px solid ${mode === m ? 'var(--brand-teal)' : 'var(--border-default)'}`,
        color: mode === m ? 'var(--brand-teal)' : 'var(--text-secondary)',
        borderRadius: 6, padding: '6px 8px',
        fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11,
        cursor: 'pointer',
      }}
    >{libelle}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {boutonMode('polygon', 'Polygone')}
        {boutonMode('rectangle', 'Rectangle')}
        {boutonMode('select', 'Modifier')}
      </div>

      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        color: 'var(--text-tertiary)', lineHeight: 1.6,
      }}>
        {nSommets > 0
          ? `${nSommets} sommet${nSommets > 1 ? 's' : ''} tracé${nSommets > 1 ? 's' : ''}`
          : mode === 'rectangle'
            ? 'Cliquez-glissez pour tracer un rectangle'
            : 'Cliquez pour poser les sommets, double-clic pour fermer'}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={effacer}
          disabled={nSommets === 0}
          style={{
            flex: 1, background: 'transparent', border: '0.5px solid var(--border-default)',
            color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 8px',
            fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11,
            cursor: nSommets === 0 ? 'not-allowed' : 'pointer', opacity: nSommets === 0 ? 0.4 : 1,
          }}
        >Effacer</button>
        <button
          type="button"
          onClick={onFermer}
          style={{
            flex: 1, background: 'transparent', border: '0.5px solid var(--border-default)',
            color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 8px',
            fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11, cursor: 'pointer',
          }}
        >Quitter le dessin</button>
      </div>
    </div>
  );
}
