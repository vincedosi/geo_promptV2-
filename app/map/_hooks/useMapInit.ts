'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MAP_STYLE, getCatColor } from '../_lib/constants';
import { IRIS_TILE_VERSION, IRIS_ZOOM_PLANCHER, CARREAUX_TILE_VERSION } from '@/lib/version';
import { applyMagelianStyle } from '@/lib/map/magelian-style';
import { useTheme } from '@/lib/theme/ThemeProvider';
import type { ZoneData } from '@/types/spatial';
import type { SelectedBillboard } from '@/types/map';
import { echapperHtml as esc } from '@/lib/map/echapper-html';

/** Valeur admissible pour `text-field` d'une couche symbole. */
type ChampTexte = NonNullable<maplibregl.SymbolLayerSpecification['layout']>['text-field'];

/** Remplace récursivement name_en/name:en par le nom local (name) dans une expression MapLibre */
function patchLabelFrValeur(expr: unknown): unknown {
  if (!expr) return expr;
  if (typeof expr === 'string') {
    return expr.replace(/\{name_en\}/g, '{name}').replace(/\{name:en\}/g, '{name}');
  }
  if (Array.isArray(expr)) {
    if (expr[0] === 'get' && (expr[1] === 'name_en' || expr[1] === 'name:en')) {
      return ['coalesce', ['get', 'name:fr'], ['get', 'name']];
    }
    return expr.map(patchLabelFrValeur);
  }
  if (typeof expr === 'object' && expr !== null) {
    return Object.fromEntries(
      Object.entries(expr as Record<string, unknown>).map(([k, v]) => [k, patchLabelFrValeur(v)])
    );
  }
  return expr;
}

/** Draw POI radius circles on the canvas overlay — called on move/zoom, not every frame */
function drawPOICirclesOnCanvas(
  map: maplibregl.Map,
  zoneDataRef: React.RefObject<ZoneData | null>,
  canvasOverlayRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const data = zoneDataRef.current;
  const c = canvasOverlayRef.current;
  const container = containerRef.current;
  if (!c || !container) return;

  const w = container.clientWidth;
  const h = container.clientHeight;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;

  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  if (!data?.rayon_poi_metres || !data.pois.length) return;

  const rM = data.rayon_poi_metres;

  for (const p of data.pois) {
    if (p.lat == null || p.lng == null) continue;
    try {
      const pt = map.project([p.lng, p.lat]);
      const zoom = map.getZoom();
      const metersPerPx = (156543.03 * Math.cos(p.lat * Math.PI / 180)) / Math.pow(2, zoom);
      const rPx = rM / metersPerPx;
      if (rPx < 1) continue;

      const color = data.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rPx, 0, 2 * Math.PI);
      ctx.fillStyle = color + '1e';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    } catch {
      // projection hors vue — skip
    }
  }
}

/**
 * Frontière typée du patch de libellés.
 *
 * Le parcours interne est en `unknown` : il traverse des expressions MapLibre
 * arbitraires dont la forme n'est pas connue statiquement. La conversion finale
 * est sûre par construction — le patch préserve la forme (chaîne → chaîne,
 * tableau → tableau) et ne substitue qu'un `['get', 'name_en']` par un
 * `['coalesce', ['get','name:fr'], ['get','name']]`, expression valide au même
 * endroit.
 *
 * Ce wrapper n'existait pas avant maplibre-gl 6 : `setLayoutProperty` acceptait
 * `any`. La v6 donne à ses propriétés leur type réel, ce qui a fait apparaître
 * cette frontière — elle était déjà là, simplement invisible.
 */
function patchLabelFr(expr: ChampTexte): ChampTexte {
  return patchLabelFrValeur(expr) as ChampTexte;
}

export function useMapInit(
  zoneData: ZoneData | null,
  onBillboardSelect?: (billboard: SelectedBillboard) => void,
  mapStyleUrl?: string,
) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef  = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<maplibregl.Map | null>(null);
  const markersRef       = useRef<maplibregl.Marker[]>([]);
  const canvasOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const zoneDataRef      = useRef<ZoneData | null>(null);

  // Sync zoneDataRef so the draw closure always reads the latest value
  // Also trigger a canvas redraw when zoneData changes
  useEffect(() => {
    zoneDataRef.current = zoneData;
    // Trigger redraw of POI circles when data changes
    if (mapRef.current && canvasOverlayRef.current) {
      drawPOICirclesOnCanvas(mapRef.current, zoneDataRef, canvasOverlayRef, mapContainerRef);
    }
  }, [zoneData]);

  // ── Init MapLibre (recreate when style changes) ──────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const DEFAULT_CENTER: [number, number] = [2.3, 46.6];
    const DEFAULT_ZOOM = 5.5;

    // Protocole PMTiles — enregistré une fois avant toute création de map
    // Le protocole `pmtiles` n'est plus enregistre : la seule couche qui s'en
    // servait (IRIS) passe desormais par /api/tiles/iris. Le workflow
    // `generate-iris-pmtiles` et son bouton d'administration restent en place
    // mais n'alimentent plus rien — a trancher (voir docs/AUDIT_IRIS_TERRAIN.md).

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyleUrl ?? MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });


    // Canvas overlay POI circles
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1';
    mapContainerRef.current.appendChild(overlay);
    canvasOverlayRef.current = overlay;

    // ── Zoom indicator ────────────────────────────────────────────────────────
    const zoomBadge = document.createElement('div');
    zoomBadge.style.cssText = [
      'position:absolute',
      'top:10px',
      'left:10px',
      'z-index:10',
      'pointer-events:none',
      'background:var(--card-overlay)',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'border:0.5px solid var(--border-default)',
      'color:var(--text-secondary)',
      'font-family:JetBrains Mono,monospace',
      'font-size:11px',
      'letter-spacing:0.05em',
      'padding:3px 8px',
      'border-radius:4px',
    ].join(';');
    const updateZoomBadge = () => {
      const z = map.getZoom();
      const zInt = Math.floor(z);
      // Miroir exact de la cascade de get_tile (sql/129) et du minzoom de la
      // couche : le tiret ne reste que sous z4, ou aucune tuile n'est servie.
      const tier =
        zInt >= 12 ? '200m' : zInt >= 9 ? '1km' : zInt >= 8 ? '2km'
          : zInt >= 7 ? '5km' : zInt >= 4 ? '20km' : '—';
      zoomBadge.textContent = `z${zInt}  ${tier}`;
    };
    updateZoomBadge();
    map.on('zoom', updateZoomBadge);
    mapContainerRef.current.appendChild(zoomBadge);

    // Draw POI radius circles on move/zoom (not every frame — saves CPU)
    const drawCircles = () => drawPOICirclesOnCanvas(map, zoneDataRef, canvasOverlayRef, mapContainerRef);
    map.on('moveend', drawCircles);
    map.on('zoomend', drawCircles);
    map.once('idle', drawCircles);

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    // ── Resize observer ─────────────────────────────────────────────────────
    // /map est rendu dans un layout flex où le container peut être plus petit
    // que sa taille finale au moment du `new Map(...)` (icon bar / overlays
    // qui apparaissent juste après le mount). Sans resize() la carte reste
    // tronquée à la taille initiale. Pattern repris de SyncMap.
    const ro = new ResizeObserver(() => { map.resize(); });
    ro.observe(mapContainerRef.current);
    map.once('idle', () => { map.resize(); });

    // Collect cleanup callbacks from load-time listener registrations
    const cleanupFns: (() => void)[] = [];

    map.on('load', () => {
      // ── Patch labels → langue locale (français) ───────────────────────────
      for (const layer of (map.getStyle()?.layers ?? [])) {
        if (layer.type !== 'symbol') continue;
        const tf = layer.layout?.['text-field'];
        if (!tf) continue;
        try { map.setLayoutProperty(layer.id, 'text-field', patchLabelFr(tf)); } catch { /* hors vue */ }
      }

      // ── Apply MAGELIAN style overrides if selected (theme-aware) ────────
      if (mapStyleUrl?.includes('magelian') || (typeof window !== 'undefined' && localStorage.getItem('genesis_map_style')?.includes('magelian'))) {
        applyMagelianStyle(map, themeRef.current);
      }

      // ── Heatmap densité POI (large zoom) ─────────────────────────────────
      map.addSource('pois-heat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'pois-heatmap',
        type: 'heatmap',
        source: 'pois-heat',
        maxzoom: 14,
        paint: {
          // Intensité croissante avec le zoom
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            0, 0.6,
            6, 1.5,
            9, 2.5,
          ] as unknown as maplibregl.ExpressionSpecification,
          // Rayon de diffusion en px selon le zoom
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 3,
            5, 10,
            9, 20,
            12, 30,
          ] as unknown as maplibregl.ExpressionSpecification,
          // Palette bleu-marine (style INSEE)
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(33,102,172,0)',
            0.15, '#c6dbef',
            0.35, '#6baed6',
            0.60, '#2171b5',
            0.80, '#08519c',
            1,   '#08306b',
          ] as unknown as maplibregl.ExpressionSpecification,
          // Fade out progressif entre zoom 11 et 13
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            11, 1,
            13, 0,
          ] as unknown as maplibregl.ExpressionSpecification,
        },
      });

      // ── Cercles POI GPU (grands datasets, remplace les DOM markers) ──────
      // Même source que la heatmap — on ajoute des layers circle dessus.
      // Visible seulement à zoom ≥ 11 (heatmap fade-out terminé à zoom 13).
      map.addLayer({
        id: 'pois-circles',
        type: 'circle',
        source: 'pois-heat',
        minzoom: 11,
        paint: {
          'circle-color': ['coalesce', ['get', 'color'], '#6366f1'] as unknown as maplibregl.ExpressionSpecification,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            3,  2,
            7,  3,
            11, 4,
            13, 6,
            16, 9,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': [
            'interpolate', ['linear'], ['zoom'],
            3, 0.7,
            7, 0.85,
            12.5, 1,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['zoom'],
            3, 0,
            7, 0.4,
            12.5, 0.9,
          ] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });

      // Click popup pour les cercles GPU
      const onPoisCirclesClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, string>;
        const categorie = String(p.categorie ?? '').toLowerCase();
        const isBillboard = categorie === 'panneaux' || categorie === 'top_ooh';

        if (isBillboard && onBillboardSelect) {
          const lat = Number(p.lat ?? e.lngLat.lat);
          const lng = Number(p.lng ?? e.lngLat.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          const toNumOrNull = (v: unknown): number | null => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          };
          onBillboardSelect({
            id: String(p.id ?? p.nom ?? 'panneau'),
            nom: p.nom ?? 'Panneau',
            lat,
            lng,
            format: p.format || p.sous_categorie || undefined,
            score: toNumOrNull(p.score_ooh),
            audience: toNumOrNull(p.audience),
            rank: toNumOrNull(p.rank),
            regie: p.regie || p.adresse || undefined,
          });
          return;
        }

        // `p.color` atterrit dans un attribut `style` : echapper le guillemet
        // double y ferme la sortie d'attribut, qui est le vecteur XSS. Reste
        // possible une injection CSS pure (changer une couleur) — cosmetique.
        const html = `<div style="font-size:12px;padding:6px 8px">` +
          `<strong>${esc(p.nom) || 'POI'}</strong><br/>` +
          `<span style="color:${esc(p.color) || '#6366f1'};font-size:11px;font-weight:600;text-transform:uppercase">${esc(p.categorie)}</span>` +
          (p.sous_categorie ? ` <span style="color:#94a3b8;font-size:11px">· ${esc(p.sous_categorie)}</span>` : '') +
          (p.adresse ? `<br/><span style="color:#64748b;font-size:11px">📍 ${esc(p.adresse)}</span>` : '') +
          `</div>`;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      };
      const onPoisCirclesMousemove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        const categorie = String(p?.categorie ?? '').toLowerCase();
        const isBillboard = categorie === 'panneaux' || categorie === 'top_ooh';
        map.getCanvas().style.cursor = isBillboard ? 'pointer' : '';
      };
      const onPoisCirclesMouseleave = () => { map.getCanvas().style.cursor = ''; };
      map.on('click', 'pois-circles', onPoisCirclesClick);
      map.on('mousemove', 'pois-circles', onPoisCirclesMousemove);
      map.on('mouseleave', 'pois-circles', onPoisCirclesMouseleave);
      cleanupFns.push(() => {
        map.off('click', 'pois-circles', onPoisCirclesClick);
        map.off('mousemove', 'pois-circles', onPoisCirclesMousemove);
        map.off('mouseleave', 'pois-circles', onPoisCirclesMouseleave);
      });

      // ── Météo — Choroplèthe par zones admin (polygones dép./régions) ─────
      // Source GeoJSON peuplée dynamiquement via /api/meteo-geo + zones.
      // Couleur via expression interpolate sur la palette de la variable.
      map.addSource('meteo-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'meteo-fill', type: 'fill', source: 'meteo-source',
        paint: {
          'fill-color': '#4ecdc4', // overridé dynamiquement
          'fill-opacity': 0.55,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'meteo-outline', type: 'line', source: 'meteo-source',
        paint: {
          'line-color': 'rgba(0,0,0,0.45)',
          'line-width': 0.8,
        },
        layout: { visibility: 'none' },
      });

      // ── TMJA — Comptages routiers (vector tiles MVT, lazy par viewport) ──
      // Pipeline calqué sur carreaux/IRIS : tiles servies par /api/tmja-tiles
      // avec cache mémoire serveur 1h, déduplication, et filtrage adaptatif
      // par seuil TMJA selon zoom (axes majeurs au low-zoom, dense au high).
      // Bump ?v= si la fonction get_tmja_tile change pour invalider le cache
      // navigateur + cache mémoire serveur.
      map.addSource('tmja-source', {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tmja-tiles/{z}/{x}/{y}?v=v10`],
        minzoom: 5,
        maxzoom: 14,
      });
      map.addLayer({
        id: 'tmja-lines', type: 'line', source: 'tmja-source',
        'source-layer': 'tmja',
        paint: {
          // Low-zoom : traits plus fins pour densité visuelle raisonnable
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            5, 0.6, 7, 1.2, 9, 2, 11, 3.2, 14, 5,
          ] as unknown as import('maplibre-gl').ExpressionSpecification,
          'line-color': [
            'step', ['get', 'tmja'],
            '#4292C6',   // < 5 000 : bleu
            5000,  '#f6d543',  // 5 000–15 000 : jaune
            15000, '#f97316',  // 15 000–40 000 : orange
            40000, '#ef4444',  // > 40 000 : rouge
          ] as unknown as import('maplibre-gl').ExpressionSpecification,
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            5, 0.95, 9, 0.9, 12, 0.8,
          ] as unknown as import('maplibre-gl').ExpressionSpecification,
        },
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      });

      // ── Radio émetteurs — clusters + heatmap + couverture ──────────────
      map.addSource('radio-emetteurs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.addLayer({
        id: 'radio-clusters', type: 'circle', source: 'radio-emetteurs',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#4ecdc4',
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24, 200, 32] as unknown as maplibregl.ExpressionSpecification,
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#050505',
        },
        layout: { visibility: 'none' },
      });

      // Cluster labels
      map.addLayer({
        id: 'radio-cluster-count', type: 'symbol', source: 'radio-emetteurs',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
          visibility: 'none',
        },
        paint: { 'text-color': '#050505' },
      });

      // Individual points (unclustered)
      map.addLayer({
        id: 'radio-points', type: 'circle', source: 'radio-emetteurs',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match', ['get', 'portee'],
            'nationale', '#3b82f6',
            'locale', '#22c55e',
            'autoroute', '#eab308',
            '#6b7280', // default: unmatched
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-radius': [
            'interpolate', ['linear'], ['coalesce', ['get', 'puissance_w'], 100],
            1, 3,
            100, 5,
            10000, 7,
            100000, 10,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-width': [
            'match', ['get', 'systeme'], 'DAB+', 1.5, 0.5,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-color': '#050505',
          'circle-opacity': 0.9,
        },
        layout: { visibility: 'none' },
      });

      // Heatmap layer (mutually exclusive with clusters)
      map.addLayer({
        id: 'radio-heatmap', type: 'heatmap', source: 'radio-emetteurs',
        maxzoom: 14,
        paint: {
          'heatmap-weight': [
            'interpolate', ['linear'], ['coalesce', ['get', 'puissance_w'], 100],
            0, 0.1, 1000, 0.5, 100000, 1,
          ] as unknown as maplibregl.ExpressionSpecification,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 9, 2] as unknown as maplibregl.ExpressionSpecification,
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 6, 15, 10, 25] as unknown as maplibregl.ExpressionSpecification,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(78,205,196,0)',
            0.15, 'rgba(78,205,196,0.15)',
            0.35, 'rgba(78,205,196,0.35)',
            0.6, 'rgba(78,205,196,0.6)',
            0.85, 'rgba(78,205,196,0.85)',
            1, '#f0f0f0',
          ] as unknown as maplibregl.ExpressionSpecification,
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11, 1, 14, 0] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });

      // Coverage circles source (separate, non-clustered)
      map.addSource('radio-coverage', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'radio-coverage-fill', type: 'fill', source: 'radio-coverage',
        paint: {
          'fill-color': ['coalesce', ['get', 'color'], '#4ecdc4'] as unknown as maplibregl.ExpressionSpecification,
          'fill-opacity': 0.06,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'radio-coverage-line', type: 'line', source: 'radio-coverage',
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#4ecdc4'] as unknown as maplibregl.ExpressionSpecification,
          'line-width': 0.5,
          'line-opacity': 0.25,
        },
        layout: { visibility: 'none' },
      });

      // Click on individual radio point → popup
      const onRadioPointClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        const nom = p.radio_nom ? String(p.radio_nom) : null;
        const sys = String(p.systeme ?? 'FM');
        const freqVal = Number(p.frequence_mhz);
        // Don't show 87.5/108 (FM band boundaries) — show just "FM"
        const freqDisplay = (freqVal && freqVal !== 87.5 && freqVal !== 108) ? `${freqVal.toFixed(1)} MHz` : sys;
        const pwVal = Number(p.puissance_w);
        const pw = pwVal > 0 ? (pwVal >= 1000000 ? `${(pwVal/1000000).toFixed(1)} MW` : pwVal >= 1000 ? `${(pwVal/1000).toFixed(1)} kW` : `${pwVal} W`) : '';
        const covVal = Number(p.rayon_couverture_m);
        const cov = covVal > 0 ? `~${Math.round(covVal / 1000)} km` : '';
        const cat = p.categorie_arcom ? `Cat. ${p.categorie_arcom}` : '';
        const portee = p.portee ? String(p.portee).charAt(0).toUpperCase() + String(p.portee).slice(1) : '';
        const genre = p.genre ? String(p.genre).replace('_', '/') : '';
        const groupe = p.groupe_media ? String(p.groupe_media) : '';

        new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 14px;font-family:'Inter',sans-serif;font-size:12px;line-height:1.6">
            <div style="font-size:14px;font-weight:600;color:${nom ? 'var(--text-primary)' : 'var(--text-tertiary)'};margin-bottom:2px">${esc(nom) || 'Radio non associée'}</div>
            ${nom ? `<div style="color:var(--text-secondary);font-size:11px;margin-bottom:6px">${[cat, portee, genre].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
            ${groupe ? `<div style="color:var(--text-tertiary);font-size:11px;margin-bottom:6px">Groupe : ${esc(groupe)}</div>` : ''}
            <div style="border-top:0.5px solid var(--border-subtle, #1a1a1a);margin:4px 0;padding-top:4px">
              <div style="color:var(--text-secondary);font-size:11px">${esc(freqDisplay)}</div>
              ${pw ? `<div style="color:var(--text-tertiary);font-size:11px">Puissance : ${esc(pw)}</div>` : ''}
              ${cov ? `<div style="color:var(--text-tertiary);font-size:11px">Couverture : ${esc(cov)}</div>` : ''}
              <div style="color:var(--text-tertiary);font-size:11px">${[esc(p.commune), p.departement ? `Dept ${esc(p.departement)}` : ''].filter(Boolean).join(' · ')}</div>
              ${p.exploitant ? `<div style="color:var(--text-tertiary);font-size:10px">Exploitant : ${esc(p.exploitant)}</div>` : ''}
            </div>
          </div>`)
          .addTo(map);
      };
      map.on('click', 'radio-points', onRadioPointClick);

      // Click on cluster → zoom in
      const onRadioClusterClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const clusterId = e.features[0].properties?.cluster_id;
        const src = map.getSource('radio-emetteurs') as maplibregl.GeoJSONSource;
        if (src && clusterId !== undefined) {
          (src as unknown as { getClusterExpansionZoom: (id: number, cb: (err: unknown, zoom: number) => void) => void })
            .getClusterExpansionZoom(clusterId, (err, zoom) => {
              if (!err) map.easeTo({ center: e.lngLat, zoom: zoom + 1 });
            });
        }
      };
      map.on('click', 'radio-clusters', onRadioClusterClick);

      // Cursor
      const onRadioEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
      const onRadioLeave = () => { map.getCanvas().style.cursor = ''; };
      map.on('mouseenter', 'radio-points', onRadioEnter);
      map.on('mouseleave', 'radio-points', onRadioLeave);
      map.on('mouseenter', 'radio-clusters', onRadioEnter);
      map.on('mouseleave', 'radio-clusters', onRadioLeave);

      cleanupFns.push(() => {
        map.off('click', 'radio-points', onRadioPointClick);
        map.off('click', 'radio-clusters', onRadioClusterClick);
        map.off('mouseenter', 'radio-points', onRadioEnter);
        map.off('mouseleave', 'radio-points', onRadioLeave);
        map.off('mouseenter', 'radio-clusters', onRadioEnter);
        map.off('mouseleave', 'radio-clusters', onRadioLeave);
      });

      // ── Zone circle ──────────────────────────────────────────────────────
      map.addSource('zone-circle', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone-circle', paint: { 'fill-color': '#4ecdc4', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'zone-outline', type: 'line', source: 'zone-circle', paint: { 'line-color': '#4ecdc4', 'line-width': 1.5, 'line-dasharray': [4, 3] } });

      // ── Isochrones ────────────────────────────────────────────────────────
      map.addSource('isochrones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'isochrones-fill', type: 'fill', source: 'isochrones', paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.18 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'isochrones-line', type: 'line', source: 'isochrones', paint: { 'line-color': '#16a34a', 'line-width': 2, 'line-opacity': 0.85 }, layout: { visibility: 'none' } });

      // ── Clustering POI × Filosofi ─────────────────────────────────────────
      //
      // Restauré le 2026-09-12, après la suppression du 2026-07-05. Deux
      // sources : l'aperçu des POI du wizard, et les POI coloriés par cluster.
      map.addSource('wizard-highlight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'wizard-highlight-layer', type: 'circle', source: 'wizard-highlight',
        paint: {
          'circle-color': '#f59e0b',
          'circle-radius': 5,
          'circle-opacity': 0.80,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#050505',
        },
        layout: { visibility: 'none' },
      });

      map.addSource('clusters-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'clusters-layer',
        type: 'circle',
        source: 'clusters-source',
        paint: {
          'circle-color':        ['get', 'cluster_color'] as unknown as maplibregl.ExpressionSpecification,
          'circle-radius':       7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity':      0.92,
        },
        layout: { visibility: 'none' },
      });

      const onClustersClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, string>;
        let profileFeatures: Record<string, number> = {};
        try { profileFeatures = JSON.parse(p.profile_features ?? '{}'); } catch { /* propriété absente ou tronquée */ }

        // Le panneau de détail écoute cet événement — il n'a pas de référence
        // vers la carte, et la carte n'en a pas vers React.
        window.dispatchEvent(new CustomEvent('genesis:cluster-select', {
          detail: {
            poi_id:           p.poi_id,
            poi_name:         p.poi_name,
            cluster_id:       Number(p.cluster_id),
            cluster_label:    p.cluster_label,
            cluster_color:    p.cluster_color,
            categorie:        p.categorie,
            ville:            p.ville,
            profile_features: profileFeatures,
            lat:              e.lngLat.lat,
            lng:              e.lngLat.lng,
          },
        }));

        // `esc()` sur CHAQUE valeur : `poi_name` et `ville` viennent de
        // `poi_france`, alimentée par des imports CSV/XLSX/ArcGIS. La version
        // d'origine de ce popup interpolait sans échapper — c'est précisément
        // la XSS fermée depuis (voir lib/map/echapper-html.ts). La restaurer
        // telle quelle aurait rouvert la faille dans le même geste.
        //
        // `cluster_color` entre dans un attribut `style` : on ne lui fait pas
        // confiance non plus, on n'accepte qu'un hexadécimal.
        const couleur = /^#[0-9a-f]{3,8}$/i.test(p.cluster_color ?? '') ? p.cluster_color : '#64748b';
        new maplibregl.Popup({ closeButton: true, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-size:12px;padding:6px 8px;font-family:sans-serif">` +
            `<b style="color:#1e293b">${esc(p.poi_name) || '—'}</b><br/>` +
            `<span style="display:inline-block;margin-top:3px;padding:1px 6px;border-radius:2px;font-size:10px;background:${couleur};color:#fff">${esc(p.cluster_label)}</span>` +
            `<div style="color:#94a3b8;font-size:10px;margin-top:3px">${esc(p.ville)}</div>` +
            `</div>`
          )
          .addTo(map);
      };
      const onClustersMousemove  = () => { map.getCanvas().style.cursor = 'pointer'; };
      const onClustersMouseleave = () => { map.getCanvas().style.cursor = ''; };
      map.on('click', 'clusters-layer', onClustersClick);
      map.on('mousemove',  'clusters-layer', onClustersMousemove);
      map.on('mouseleave', 'clusters-layer', onClustersMouseleave);
      cleanupFns.push(() => {
        map.off('click', 'clusters-layer', onClustersClick);
        map.off('mousemove', 'clusters-layer', onClustersMousemove);
        map.off('mouseleave', 'clusters-layer', onClustersMouseleave);
      });

      // ── IRIS choroplèthe — tuiles MVT servies par /api/tiles/iris ───────────
      //
      // Remplace un PMTiles de 361 Mo qui n'atteignait jamais la production :
      // `.vercelignore` l'excluait du déploiement, et la GitHub Release censée
      // le porter répond 404 en anonyme (dépôt privé). La couche ne s'affichait
      // que sur le poste du développeur — sans erreur, MapLibre échouant en
      // silence sur une source vide.
      //
      // `IRIS_ZOOM_PLANCHER` des deux côtés, et c'est la MÊME constante que la
      // route : les mesures qui l'imposent sont dans `lib/version.ts`.
      //
      // Sous le minzoom d'une source, MapLibre ne demande AUCUNE tuile — voir
      // le commentaire de la source carreaux plus bas, même règle. La carte
      // démarrant à z5,5 (`DEFAULT_ZOOM`), activer la couche depuis la vue
      // France ne produit donc rien : c'est `setIrisVisible` qui remonte la
      // caméra au plancher, et le panneau qui l'annonce.
      //
      // Inséré AVANT carreaux pour z-order : IRIS sous carreaux sous POIs.
      map.addSource('iris-source', {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tiles/iris/{z}/{x}/{y}?v=${IRIS_TILE_VERSION}`],
        minzoom: IRIS_ZOOM_PLANCHER,
        maxzoom: 14,
        attribution: 'IGN — IRIS 2023',
      });
      map.addLayer({
        id: 'iris-fill', type: 'fill',
        source: 'iris-source',
        'source-layer': 'iris',
        minzoom: IRIS_ZOOM_PLANCHER,
        paint: {
          'fill-color':   '#4292C6',
          'fill-opacity': 0.45,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'iris-border', type: 'line',
        source: 'iris-source',
        'source-layer': 'iris',
        minzoom: IRIS_ZOOM_PLANCHER,
        paint: {
          'line-color': 'rgba(66,146,198,0.7)',
          // Les arrêts couvrent toute la cascade : un contour de département à z5
          // doit être plus fin qu'un contour d'IRIS à z14, sans quoi la vue France
          // se noie dans le trait.
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.2, 7, 0.3, 12, 0.6, 14, 1.2] as unknown as maplibregl.ExpressionSpecification,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 7, 0.35, 12, 0.5, 14, 0.6] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });
      // Jumelle en relief de `iris-fill`. Les deux ne coexistent JAMAIS : leurs
      // géométries sont coplanaires à la base, ce qui produit du z-fighting sur
      // la face supérieure — même contrainte que les carreaux.
      map.addLayer({
        id: 'iris-extrusion', type: 'fill-extrusion',
        source: 'iris-source',
        'source-layer': 'iris',
        minzoom: IRIS_ZOOM_PLANCHER,
        paint: {
          'fill-extrusion-color': '#4292C6',
          'fill-extrusion-opacity': 0.85,
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
        },
        layout: { visibility: 'none' },
      });

      // ── Carreaux MVT (Filosofi) ─────────────────────────────────────────────
      // Cascade servie par get_tile (sql/129) :
      //   z <= 6   → carreaux_20km (vue materialisee sql/124)
      //   z 7      → carreaux_5km
      //   z 8      → carreaux_2km
      //   z 9-11   → carreaux_1km   (sql/129, 374 511 mailles, 151 Mo)
      //   z >= 12  → carreaux_filosofi 200m
      //
      // Le palier 1 km existe pour z9 : servir du 200 m a ce niveau coutait
      // 23 a 28 s a froid pour 82 000 carreaux larges de 0,9 px. Sous 10 px on
      // ne distingue plus les carreaux les uns des autres — 1 km (4,7 px) et
      // 200 m (0,9 px) se lisent tous deux comme un degrade continu, mais le
      // premier coute 25 fois moins.
      //
      // Ne pas descendre le seuil du 200 m sous z12 sans avoir d'abord donne a
      // carreaux_filosofi des colonnes typees : ses 4,6 Go et son jsonb de
      // 806 o/ligne imposent un plancher d'I/O que nulle requete ne franchit.
      //
      // minzoom 4 et non 6 : en dessous de son minzoom, MapLibre ne DEMANDE
      // pas les tuiles — les carreaux etaient donc invisibles avant z6, quoi
      // que serve le serveur.
      map.addSource('carreaux-mvt', {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}?v=${CARREAUX_TILE_VERSION}`],
        minzoom: 4,
        maxzoom: 14,
        attribution: 'INSEE, Filosofi 2019',
      });
      map.addLayer({
        id: 'carreaux-mvt-fill', type: 'fill',
        source: 'carreaux-mvt', 'source-layer': 'carreaux',
        minzoom: 4,
        paint: { 'fill-color': '#FC9272', 'fill-opacity': 0.65 },
        layout: { visibility: 'none' },
      });
      // ── Carreaux en 3D ────────────────────────────────────────────────────
      // Couche jumelle de `carreaux-mvt-fill`, en extrusion. Les deux ne sont
      // JAMAIS visibles ensemble : superposer un aplat et son extrusion produit
      // du z-fighting sur la face superieure, les deux geometries etant
      // coplanaires a la base.
      //
      // La hauteur est posee par useMapLayers a partir des MEMES bornes
      // nationales que la couleur (lib/carreaux/bornes.ts). Couleur et hauteur
      // racontent donc la meme histoire, lues sur deux axes — c'est ce qui rend
      // la 3D honnete plutot que decorative.
      //
      // `fill-extrusion-opacity` n'est PAS data-driven dans MapLibre : le filtre
      // par palier de la legende, qui joue sur l'opacite feature par feature, ne
      // peut pas s'appliquer ici. En 3D la selection d'une tranche est donc sans
      // effet visuel — limite du moteur, pas du code.
      map.addLayer({
        id: 'carreaux-mvt-extrusion', type: 'fill-extrusion',
        source: 'carreaux-mvt', 'source-layer': 'carreaux',
        minzoom: 4,
        paint: {
          'fill-extrusion-color': '#FC9272',
          'fill-extrusion-opacity': 0.85,
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'carreaux-mvt-line', type: 'line',
        source: 'carreaux-mvt', 'source-layer': 'carreaux',
        minzoom: 9,
        paint: {
          'line-color': '#555',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.05, 10, 0.1, 12, 0.3, 14, 0.8] as unknown as maplibregl.ExpressionSpecification,
          'line-opacity': 0.35,
        },
        layout: { visibility: 'none' },
      });

      // ── Test ORS ──────────────────────────────────────────────────────────
      map.addSource('test-iso', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'test-iso-fill', type: 'fill', source: 'test-iso', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.5 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'test-iso-line', type: 'line', source: 'test-iso', paint: { 'line-color': '#1d4ed8', 'line-width': 2, 'line-opacity': 0.9 }, layout: { visibility: 'none' } });

      const onTestIsoClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6"><b style="color:#1e293b">${esc(p.cirfa_nom) || '—'}</b><br/><span style="color:#2563eb;font-weight:600">⏱ ${esc(p.minutes_req) || '?'} min (${esc(p.mode) || '?'})</span><br/><span style="color:#94a3b8;font-size:10px">id: ${esc(p.cirfa_id) || '?'}</span></div>`)
          .addTo(map);
      };
      map.on('click', 'test-iso-fill', onTestIsoClick);
      cleanupFns.push(() => { map.off('click', 'test-iso-fill', onTestIsoClick); });

      // ── Bataille d'Isochrones ─────────────────────────────────────────────
      map.addSource('battle-rings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'battle-fill', type: 'fill', source: 'battle-rings',
        // Filtre : ne jamais rendre les border features comme polygones remplis
        filter: ['!=', ['get', 'feature_type'], 'border'] as unknown as maplibregl.ExpressionSpecification,
        paint: {
          'fill-color':   ['coalesce', ['get', 'battle_color'],   '#4e79a7'] as unknown as maplibregl.ExpressionSpecification,
          'fill-opacity': ['coalesce', ['get', 'battle_opacity'], 0.5]       as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'battle-ring-line', type: 'line', source: 'battle-rings',
        filter: ['!=', ['get', 'feature_type'], 'border'] as unknown as maplibregl.ExpressionSpecification,
        paint: { 'line-color': 'rgba(0,0,0,0.15)', 'line-width': 0.5, 'line-opacity': 0.6 },
        layout: { visibility: 'none' },
      });

      map.addSource('battle-borders', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'battle-cirfa-border', type: 'line', source: 'battle-borders',
        paint: { 'line-color': '#111827', 'line-width': 1, 'line-opacity': 0.3 },
        layout: { visibility: 'none' },
      });

      const onBattleFillClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const palier = Number(props.palier ?? 0);
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:220px"><b style="color:#1e293b">${esc(props.nom) || '—'}</b><br/><span style="color:#64748b;font-size:11px">${esc(props.adresse)}</span><div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(props.ville)}</div><div style="margin-top:4px;font-weight:600;color:#059669">⏱ Anneau ${palier} min</div></div>`)
          .addTo(map);
      };
      map.on('click', 'battle-fill', onBattleFillClick);
      cleanupFns.push(() => { map.off('click', 'battle-fill', onBattleFillClick); });

      map.addSource('battle-pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'battle-pois-circle', type: 'circle', source: 'battle-pois',
        paint: { 'circle-radius': 5, 'circle-color': '#dc2626', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-opacity': 1, 'circle-pitch-alignment': 'map' },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'battle-pois-halo', type: 'circle', source: 'battle-pois',
        paint: { 'circle-radius': 12, 'circle-color': '#ffffff', 'circle-opacity': 0.3, 'circle-blur': 1, 'circle-pitch-alignment': 'map' },
        layout: { visibility: 'none' },
      }, 'battle-pois-circle');

      const onBattlePoisClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:240px"><b style="color:#1e293b">${esc(p.nom) || '—'}</b><br/><span style="color:#64748b;font-size:11px">${esc(p.adresse)}</span><div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(p.ville)}</div></div>`)
          .addTo(map);
      };
      map.on('click', 'battle-pois-circle', onBattlePoisClick);
      cleanupFns.push(() => { map.off('click', 'battle-pois-circle', onBattlePoisClick); });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      setMapReady(false);
      ro.disconnect();
      // Remove pre-load listeners
      map.off('zoom', updateZoomBadge);
      map.off('moveend', drawCircles);
      map.off('zoomend', drawCircles);
      // Remove load-time layer listeners
      for (const fn of cleanupFns) { try { fn(); } catch { /* ok */ } }
      maplibregl.removeProtocol('pmtiles');
      map.remove();
      mapRef.current = null;
      overlay.remove();
      zoomBadge.remove();
      canvasOverlayRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyleUrl]);

  // ── Re-apply MAGELIAN overrides on theme toggle (only when magelian style) ─
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const isMagelian =
      mapStyleUrl?.includes('magelian') ||
      (typeof window !== 'undefined' && localStorage.getItem('genesis_map_style')?.includes('magelian'));
    if (!isMagelian) return;
    const reapply = () => applyMagelianStyle(map, theme);
    if (map.isStyleLoaded()) reapply();
    else map.once('load', reapply);
  }, [theme, mapStyleUrl]);

  return {
    mapContainerRef,
    mapRef,
    markersRef,
    canvasOverlayRef,
    mapReady,
    zoneDataRef,
  };
}
