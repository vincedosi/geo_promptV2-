'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';

// =============================================================================
// Types
// =============================================================================

interface POI {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  categorie: string;
  sous_categorie?: string;
  adresse?: string;
  ville?: string;
}

interface ZoneData {
  ville: string;
  rayon_metres: number | null;
  rayon_poi_metres: number | null;
  coordonnees: { lat: number; lng: number };
  pois: POI[];
  nb_pois: number;
  categories: Record<string, number>;
}

interface CarreauxData {
  action: 'afficher_carreaux';
  indicateur: string;
  indicateur_label: string;
  ville?: string;
  coordonnees: { lat: number; lng: number };
}

interface IsochroneData {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  _meta: { mode: string; minutes: number };
  _fromCache?: boolean;
  _cachedAt?: string;
}

interface VoronoiData {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  _meta?: {
    category:          string;
    metropolitaine?:   boolean;
    filtre_ville?:     string | null;
    filtre_region?:    string | null;
    filtre_dept?:      string | null;

    mode?:             string;
    levels?:           number[];
  };
}

interface SavedMap {
  id: string;
  name: string;
  ville?: string;
  nb_pois: number;
  created_at: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  zoneData?: ZoneData;
  carreauxData?: CarreauxData;
}

// =============================================================================
// Helpers
// =============================================================================

function circleGeoJSON(
  lng: number,
  lat: number,
  radiusM: number,
  steps = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const R = 6371000;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dx = radiusM * Math.cos(a);
    const dy = radiusM * Math.sin(a);
    const dLng = (dx / R) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
    const dLat = (dy / R) * (180 / Math.PI);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

// Couleurs par mode d'isochrone
const ISOCHRONE_COLORS: Record<string, { fill: string; line: string }> = {
  walk:  { fill: '#22c55e', line: '#16a34a' },
  drive: { fill: '#f97316', line: '#ea580c' },
  bike:  { fill: '#3b82f6', line: '#2563eb' },
};

const ISOCHRONE_MODE_LABELS: Record<string, string> = {
  walk:  'À pied',
  drive: 'Voiture',
  bike:  'Vélo',
};

// Couleurs par catégorie (cohérent avec MapContainer.tsx)
const CATEGORY_COLORS: Record<string, string> = {
  lycee: '#6366f1',
  college: '#3b82f6',
  cirfa: '#ef4444',
  gare: '#10b981',
  sport: '#f59e0b',
  default: '#8b5cf6',
};

function getCatColor(cat: string): string {
  return CATEGORY_COLORS[cat?.toLowerCase()] || CATEGORY_COLORS.default;
}

// Palette Tableau-20 pour colorisation dynamique des polygones Voronoï géométrique
const VORONOI_PALETTE = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
  '#86bcb6','#d4a6c8','#8cd17d','#499894','#f1ce63',
  '#d37295','#fabfd2','#b6992d','#79706e','#7a9cc0',
];

// Opacité par palier (minutes) pour la Bataille d'Isochrones
// Plus proche = plus opaque (= plus dominant visuellement)
const BATTLE_PALIER_OPACITY: Record<number, number> = {
  10:  0.65,
  30:  0.50,
  60:  0.38,
  90:  0.28,
  120: 0.18,
  150: 0.11,
};


function applyChoropleth(map: maplibregl.Map, features: GeoJSON.Feature[], metricKey: string) {
  const vals = features
    .map(f => Number((f.properties as Record<string, unknown>)?.[metricKey]))
    .filter(n => !isNaN(n) && n > 0);
  if (vals.length === 0) return;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  if (mx <= mn) return;
  const step = (mx - mn) / 4;
  map.setPaintProperty('carreaux-fill', 'fill-color', [
    'interpolate', ['linear'],
    ['case', ['>', ['coalesce', ['to-number', ['get', metricKey], 0], 0], 0],
      ['coalesce', ['to-number', ['get', metricKey], 0], 0], 0],
    0,        'rgba(0,0,0,0)',   // valeur 0 = donnée supprimée INSEE → transparent
    mn,       '#f7fbff',
    mn + step, '#9ecae1',
    mn + 2 * step, '#4292c6',
    mn + 3 * step, '#2171b5',
    mx,       '#08306b',
  ] as unknown as maplibregl.ExpressionSpecification);
  map.setPaintProperty('carreaux-fill', 'fill-opacity', [
    'case',
    ['>', ['coalesce', ['to-number', ['get', metricKey], 0], 0], 0], 0.7,
    0,
  ] as unknown as maplibregl.ExpressionSpecification);
}

// Même style CARTO Light que /map
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://openstreetmap.org/copyright">OSM</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'carto-bg', type: 'raster', source: 'carto' }],
};

// =============================================================================
// Composants
// =============================================================================

function ZoneCard({ zone }: { zone: ZoneData }) {
  const catEntries = Object.entries(zone.categories ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{
      background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 10, padding: '12px 14px', marginTop: 8,
      fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16 }}>📍</span>
        <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 13 }}>{zone.ville}</span>
        {zone.rayon_metres && (
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            zone {(zone.rayon_metres / 1000).toFixed(1)} km
          </span>
        )}
        {zone.rayon_poi_metres && (
          <span style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, padding: '1px 6px', color: '#10b981', fontSize: 11 }}>
            ⊙ {zone.rayon_poi_metres >= 1000 ? `${(zone.rayon_poi_metres/1000).toFixed(1)} km` : `${zone.rayon_poi_metres} m`} / POI
          </span>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <Stat label="Établissements trouvés" value={String(zone.nb_pois)} color={zone.nb_pois > 0 ? '#3dffa0' : '#f59e0b'} />
      </div>

      {zone.nb_pois === 0 ? (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '7px 10px', color: '#f59e0b', fontSize: 11 }}>
          Aucun établissement dans ce rayon — essayez un rayon plus large
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {catEntries.map(([cat, count]) => (
            <span key={cat} style={{
              background: `${getCatColor(cat)}22`,
              border: `1px solid ${getCatColor(cat)}55`,
              borderRadius: 5, padding: '3px 7px',
              color: getCatColor(cat), fontSize: 11, fontWeight: 600,
            }}>
              {cat} · {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '7px 10px' }}>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px 14px 14px 14px' }}>
      {[0, 0.2, 0.4].map((d, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.4)', display: 'inline-block', animation: `bounce 1s ${d}s ease-in-out infinite` }} />
      ))}
    </div>
  );
}

// =============================================================================
// Page principale
// =============================================================================

export default function CopilotePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [zoneData, setZoneData] = useState<ZoneData | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voronoï layer
  const [voronoiVisible, setVoronoiVisible] = useState(false);
  const [voronoiCategory, setVoronoiCategory] = useState<string>('');
  const [voronoiCirfas, setVoronoiCirfas] = useState<{ id: string; nom: string; color: string }[]>([]);

  // Bataille d'Isochrones layer
  const [battleVisible, setBattleVisible] = useState(false);
  const [battleCategory, setBattleCategory] = useState<string>('');
  const [battleCirfas, setBattleCirfas] = useState<{ id: string; nom: string; color: string }[]>([]);

  // Test ORS — validation polygones routiers bruts
  const [testIsoVisible, setTestIsoVisible] = useState(false);
  const [testIsoLoading, setTestIsoLoading] = useState(false);
  const [testIsoDebug,   setTestIsoDebug]   = useState<string>('');

  // Isochrones layer
  const [isochroneVisible, setIsochroneVisible] = useState(false);
  const [isochroneMode, setIsochroneMode] = useState<string>('walk');
  const [isochroneMinutes, setIsochroneMinutes] = useState<number>(0);
  const [isochroneFromCache, setIsochroneFromCache] = useState(false);
  const [isochroneCachedAt, setIsochroneCachedAt] = useState<string>('');
  // Derniers params isochrone reçus (pour le bouton "Recalculer")
  const lastIsochroneDataRef = useRef<IsochroneData | null>(null);
  const lastUserMessageRef   = useRef<string>('');

  // Save / Load
  const [savedMaps, setSavedMaps] = useState<SavedMap[]>([]);
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Stocke les dernières données isochrone complètes pour la sauvegarde
  const isochroneDataForSaveRef = useRef<IsochroneData | null>(null);
  // Stocke la config carreaux courante pour la sauvegarde
  const carreauxConfigForSaveRef = useRef<{
    tableName: string; indicateur: string; indicateur_label: string; coordonnees: { lat: number; lng: number };
  } | null>(null);

  // Carreaux layer
  const [carreauxVisible, setCarreauxVisible] = useState(false);
  const [carreauxLoaded, setCarreauxLoaded] = useState(false);
  const carreauxDataRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const [carreauxIndicateur, setCarreauxIndicateur] = useState<string>('');
  const [carreauxLabel, setCarreauxLabel] = useState<string>('');
  const [carreauxSources, setCarreauxSources] = useState<{ tableName: string; name: string }[]>([]);
  const carreauxSourcesRef = useRef<{ tableName: string; name: string }[]>([]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Données Voronoï courantes pour la sauvegarde
  const voronoiDataForSaveRef = useRef<VoronoiData | null>(null);

  // Canvas overlay pour les cercles POI (plus fiable que les layers GeoJSON MapLibre)
  const canvasOverlayRef = useRef<HTMLCanvasElement | null>(null);
  // Ref pour accéder à zoneData depuis le callback map.on('render') sans closure stale
  const zoneDataRef = useRef<ZoneData | null>(null);

  // Sync refs ↔ states
  useEffect(() => { zoneDataRef.current = zoneData; }, [zoneData]);
  useEffect(() => { carreauxSourcesRef.current = carreauxSources; }, [carreauxSources]);

  // ── Chargement des sources carreaux au montage ─────────────────────────────
  useEffect(() => {
    fetch('/api/carreaux')
      .then(r => r.json())
      .then(data => {
        if (data.sources?.length > 0) {
          setCarreauxSources(data.sources);
          carreauxSourcesRef.current = data.sources;
        }
      })
      .catch(() => {});
  }, []);

  // ── loadCarreauxFromAI : déclenché par la réponse Mistral ─────────────────
  const loadCarreauxFromAI = async (cd: CarreauxData) => {
    const map = mapRef.current;
    const sources = carreauxSourcesRef.current;
    if (!map || sources.length === 0) {
      console.warn('[Copilote] Pas de source carreaux disponible');
      return;
    }

    const tableName = sources[0].tableName;
    const { lat, lng } = cd.coordonnees;

    // Fly to city first
    map.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 });

    // Bbox autour de la ville (~20km radius, adapté zoom 12)
    const dlat = 0.12;
    const dlng = 0.18 / Math.cos(lat * Math.PI / 180);
    const bbox = [lng - dlng, lat - dlat, lng + dlng, lat + dlat];

    try {
      const res = await fetch('/api/carreaux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName, bbox }),
      });
      const gjData = await res.json();
      if (!gjData.features || gjData.features.length === 0) {
        console.warn('[Copilote] Aucun carreau dans la bbox');
        return;
      }

      const source = map.getSource('carreaux') as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      source.setData(gjData as GeoJSON.FeatureCollection);
      applyChoropleth(map, gjData.features, cd.indicateur);
      map.setLayoutProperty('carreaux-fill', 'visibility', 'visible');
      map.setLayoutProperty('carreaux-line', 'visibility', 'visible');

      setCarreauxVisible(true);
      setCarreauxLoaded(true);
      setCarreauxIndicateur(cd.indicateur);
      setCarreauxLabel(cd.indicateur_label);
      console.log(`[Copilote] Carreaux IA chargés : ${gjData.features.length} features, indicateur="${cd.indicateur}"`);
    } catch (err) {
      console.error('[Copilote] loadCarreauxFromAI error:', err);
    }
  };

  // ── applyVoronoi : applique les polygones de Voronoï sur la carte ─────────
  const applyVoronoi = (vData: VoronoiData) => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Stocker pour la sauvegarde
    voronoiDataForSaveRef.current = vData;

    // Auto-remplir le nom de sauvegarde avec un nom suggestif
    const meta  = vData._meta;
    const geo   = meta?.filtre_region ?? meta?.filtre_ville ?? meta?.filtre_dept ?? '';
    setSaveName(`Voronoï ${meta?.category ?? ''} ${geo}`.trim().replace(/\s+/g, ' '));

    // Palette par CIRFA ID : chaque secteur a une couleur cohérente (même CIRFA = même couleur).
    const cirfaColorMap = new Map<string, string>();
    let _colorIdx = 0;
    for (const f of vData.features) {
      const cid = String((f.properties as any)?.id ?? '');
      if (cid && !cirfaColorMap.has(cid)) {
        cirfaColorMap.set(cid, VORONOI_PALETTE[_colorIdx % VORONOI_PALETTE.length]);
        _colorIdx++;
      }
    }
    const featuresWithColors = vData.features.map((f) => {
      const cid = String((f.properties as any)?.id ?? '');
      const voronoi_color = cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0];
      return { ...f, properties: { ...f.properties, voronoi_color } };
    });

    const source = map.getSource('voronoi') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData({ type: 'FeatureCollection', features: featuresWithColors } as GeoJSON.FeatureCollection);
    map.setLayoutProperty('voronoi-fill', 'visibility', 'visible');
    map.setLayoutProperty('voronoi-line', 'visibility', 'visible');
    setVoronoiVisible(true);
    setVoronoiCategory(vData._meta?.category ?? '');

    // Extraire les POIs uniques depuis les propriétés (lat/lng inclus par SQL v5.10.4+)
    const poisSeen = new Set<string>();
    const poiFeatures: GeoJSON.Feature[] = [];
    for (const f of featuresWithColors) {
      const p = f.properties as Record<string, unknown>;
      const pid = String(p.id ?? '');
      const plat = Number(p.lat);
      const plng = Number(p.lng);
      if (pid && !poisSeen.has(pid) && !isNaN(plat) && !isNaN(plng) && plat && plng) {
        poisSeen.add(pid);
        poiFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [plng, plat] },
          properties: { nom: p.nom, categorie: p.categorie, adresse: p.adresse, ville: p.ville, id: pid },
        });
      }
    }
    // Layer GL — points minimalistes avec halo
    const poisSource = map.getSource('voronoi-pois') as maplibregl.GeoJSONSource | undefined;
    if (poisSource) {
      poisSource.setData({ type: 'FeatureCollection', features: poiFeatures });
      if (poiFeatures.length > 0) {
        try {
          map.setLayoutProperty('voronoi-pois-halo', 'visibility', 'visible');
          map.setLayoutProperty('voronoi-pois-circle', 'visibility', 'visible');
        } catch {}
      }
    }

    // Construire la liste CIRFA pour la légende (ordre d'apparition dans les features)
    const _cirfaSeen = new Set<string>();
    const cirfaLegend: { id: string; nom: string; color: string }[] = [];
    for (const f of featuresWithColors) {
      const p = f.properties as any;
      const cid = String(p?.id ?? '');
      if (cid && !_cirfaSeen.has(cid)) {
        _cirfaSeen.add(cid);
        cirfaLegend.push({ id: cid, nom: String(p?.nom ?? cid), color: cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0] });
      }
    }
    setVoronoiCirfas(cirfaLegend);

    // Fitter la carte sur les polygones
    if (featuresWithColors.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      let extended = false;
      for (const f of featuresWithColors) {
        const geom = (f as GeoJSON.Feature<GeoJSON.Polygon>).geometry;
        if (!geom || geom.type !== 'Polygon') continue;
        for (const coord of geom.coordinates.flat()) {
          bounds.extend([coord[0], coord[1]]);
          extended = true;
        }
      }
      if (extended) map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1200 });
    }
    console.log(`[Copilote] Voronoï appliqué: ${featuresWithColors.length} polygones, ${poiFeatures.length} centres, catégorie="${vData._meta?.category ?? ''}"`);
  };

  // ── Toggle visibilité Voronoï ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = voronoiVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('voronoi-fill', 'visibility', vis);
      map.setLayoutProperty('voronoi-line', 'visibility', vis);
      map.setLayoutProperty('voronoi-pois-halo', 'visibility', vis);
      map.setLayoutProperty('voronoi-pois-circle', 'visibility', vis);
    } catch { /* layer pas encore prêt */ }
  }, [voronoiVisible, mapReady]);

  // ── applyIsochroneBattle : anneaux vrais isochrones ORS (zéro Voronoï) ──────
  const applyIsochroneBattle = (
    ringData:   { type: string; features: GeoJSON.Feature[] },
    borderData: { type: string; features: GeoJSON.Feature[] } | null | undefined,
    category?:  string
  ) => {
    const map = mapRef.current;
    if (!map) return;

    // ── Palette couleur par CIRFA ID ──────────────────────────────────────
    const cirfaColorMap = new Map<string, string>();
    let _colorIdx = 0;
    for (const f of ringData.features) {
      const cid = String((f.properties as any)?.id ?? '');
      if (cid && !cirfaColorMap.has(cid)) {
        cirfaColorMap.set(cid, VORONOI_PALETTE[_colorIdx % VORONOI_PALETTE.length]);
        _colorIdx++;
      }
    }

    // ── Enrichir chaque anneau avec battle_color + battle_opacity ─────────
    // battle_opacity décroît avec le palier : 10 min = opaque, 120 min = translucide
    const styledRings = ringData.features.map((f) => {
      const p      = f.properties as any;
      const cid    = String(p?.id    ?? '');
      const palier = Number(p?.palier ?? 120);
      return {
        ...f,
        properties: {
          ...p,
          battle_color:   cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0],
          battle_opacity: BATTLE_PALIER_OPACITY[palier] ?? 0.18,
        },
      };
    });

    // ── Alimenter la source anneaux ───────────────────────────────────────
    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    if (!ringSrc) return;
    ringSrc.setData({ type: 'FeatureCollection', features: styledRings } as GeoJSON.FeatureCollection);

    // ── Alimenter la source bordures CIRFA (union par CIRFA → contour 3px) ─
    const borderSrc = map.getSource('battle-borders') as maplibregl.GeoJSONSource | undefined;
    if (borderSrc && borderData?.features?.length) {
      borderSrc.setData(borderData as unknown as GeoJSON.FeatureCollection);
      try { map.setLayoutProperty('battle-cirfa-border', 'visibility', 'visible'); } catch {}
    }

    // ── Afficher les layers ────────────────────────────────────────────────
    try {
      map.setLayoutProperty('battle-fill',      'visibility', 'visible');
      map.setLayoutProperty('battle-ring-line', 'visibility', 'visible');
    } catch {}
    setBattleVisible(true);
    setBattleCategory(category ?? '');

    // ── Marqueurs POI (centre de chaque CIRFA) ────────────────────────────
    const poisSeen = new Set<string>();
    const poiFeatures: GeoJSON.Feature[] = [];
    for (const f of ringData.features) {
      const p    = f.properties as Record<string, unknown>;
      const pid  = String(p.id  ?? '');
      const plat = Number(p.lat);
      const plng = Number(p.lng);
      if (pid && !poisSeen.has(pid) && !isNaN(plat) && !isNaN(plng) && plat && plng) {
        poisSeen.add(pid);
        poiFeatures.push({
          type:       'Feature',
          geometry:   { type: 'Point', coordinates: [plng, plat] },
          properties: { nom: p.nom, adresse: p.adresse, ville: p.ville, id: pid },
        });
      }
    }
    const poisSrc = map.getSource('battle-pois') as maplibregl.GeoJSONSource | undefined;
    if (poisSrc && poiFeatures.length > 0) {
      poisSrc.setData({ type: 'FeatureCollection', features: poiFeatures });
      try {
        map.setLayoutProperty('battle-pois-halo',   'visibility', 'visible');
        map.setLayoutProperty('battle-pois-circle', 'visibility', 'visible');
      } catch {}
    }

    // ── Légende CIRFA ─────────────────────────────────────────────────────
    const _seen = new Set<string>();
    const legend: { id: string; nom: string; color: string }[] = [];
    for (const f of styledRings) {
      const p   = f.properties as any;
      const cid = String(p?.id ?? '');
      if (cid && !_seen.has(cid)) {
        _seen.add(cid);
        legend.push({ id: cid, nom: String(p?.nom ?? cid), color: cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0] });
      }
    }
    setBattleCirfas(legend);

    // ── Fit bounds sur les vrais polygones isochrones ─────────────────────
    if (styledRings.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      let extended = false;
      for (const f of styledRings) {
        const geom = (f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>).geometry;
        if (!geom) continue;
        const coordRings = geom.type === 'MultiPolygon'
          ? geom.coordinates.flat(1)
          : geom.type === 'Polygon' ? geom.coordinates : [];
        for (const ring of coordRings) {
          for (const coord of ring) {
            bounds.extend([coord[0], coord[1]]);
            extended = true;
          }
        }
      }
      if (extended) map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1200 });
    }

    console.log(
      `[Copilote] Bataille d'Isochrones: ${styledRings.length} anneaux, ` +
      `${borderData?.features?.length ?? 0} bordures CIRFA, ${poiFeatures.length} centres`
    );
  };

  // ── Toggle visibilité Bataille d'Isochrones ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = battleVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('battle-fill',         'visibility', vis);
      map.setLayoutProperty('battle-ring-line',    'visibility', vis);
      map.setLayoutProperty('battle-cirfa-border', 'visibility', vis);
      map.setLayoutProperty('battle-pois-halo',    'visibility', vis);
      map.setLayoutProperty('battle-pois-circle',  'visibility', vis);
    } catch { /* layer pas encore prêt */ }
  }, [battleVisible, mapReady]);

  // ── Toggle test-iso ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = testIsoVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('test-iso-fill', 'visibility', vis);
      map.setLayoutProperty('test-iso-line', 'visibility', vis);
    } catch {}
  }, [testIsoVisible, mapReady]);

  // ── runTestIsochrone : appel ORS brut, preuve de polygone routier réel ────
  const runTestIsochrone = async (
    region   = 'Bretagne',
    category = 'cirfa',
    minutes  = 10,
    mode     = 'drive'
  ) => {
    const map = mapRef.current;
    if (!map || testIsoLoading) return;

    setTestIsoLoading(true);
    setTestIsoDebug('Appel ORS en cours…');

    try {
      const url = `/api/test-isochrone?region=${encodeURIComponent(region)}&category=${encodeURIComponent(category)}&minutes=${minutes}&mode=${mode}`;
      const res  = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.error) {
        setTestIsoDebug(`❌ ${data.error ?? 'Erreur inconnue'}`);
        return;
      }

      // Afficher les polygones bruts sur la carte
      const src = map.getSource('test-iso') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data as GeoJSON.FeatureCollection);
        setTestIsoVisible(true);
      }

      const d = data._debug;
      setTestIsoDebug(
        `${d?.message ?? '?'} | ${d?.tested_count ?? '?'} CIRFAs testés / ${d?.poi_count ?? '?'} trouvés`
      );

      // Fit bounds sur les polygones ORS reçus
      if (data.features?.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        let extended = false;
        for (const f of data.features) {
          const geom = f.geometry;
          if (!geom) continue;
          const rings = geom.type === 'MultiPolygon'
            ? geom.coordinates.flat(1)
            : geom.type === 'Polygon' ? geom.coordinates : [];
          for (const ring of rings) {
            for (const coord of ring) {
              bounds.extend([coord[0], coord[1]]);
              extended = true;
            }
          }
        }
        if (extended) map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 900 });
      }
    } catch (e: any) {
      setTestIsoDebug(`❌ ${e.message}`);
    } finally {
      setTestIsoLoading(false);
    }
  };


  // ── applyIsochrones : applique les polygones ORS sur la carte ─────────────
  const applyIsochrones = (isoData: IsochroneData) => {
    const map = mapRef.current;
    if (!map) return;

    const mode   = isoData._meta?.mode ?? 'walk';
    const colors = ISOCHRONE_COLORS[mode] ?? ISOCHRONE_COLORS.walk;

    const source = map.getSource('isochrones') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(isoData as unknown as GeoJSON.FeatureCollection);
    map.setPaintProperty('isochrones-fill', 'fill-color', colors.fill);
    map.setPaintProperty('isochrones-line', 'line-color', colors.line);
    map.setLayoutProperty('isochrones-fill', 'visibility', 'visible');
    map.setLayoutProperty('isochrones-line', 'visibility', 'visible');

    setIsochroneMode(mode);
    setIsochroneMinutes(isoData._meta?.minutes ?? 0);
    setIsochroneFromCache(isoData._fromCache ?? false);
    setIsochroneCachedAt(isoData._cachedAt ?? '');
    setIsochroneVisible(true);

    // Stocker pour recalcul et sauvegarde
    lastIsochroneDataRef.current    = isoData;
    isochroneDataForSaveRef.current = isoData;

    console.log(`[Copilote] Isochrones appliqués: ${isoData.features.length} polygones, mode=${mode}, ${isoData._meta?.minutes ?? 0}min, cache=${isoData._fromCache ?? false}`);
  };

  // ── Toggle visibilité isochrones ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = isochroneVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('isochrones-fill', 'visibility', vis);
      map.setLayoutProperty('isochrones-line', 'visibility', vis);
    } catch { /* layer pas encore ajouté */ }
  }, [isochroneVisible, mapReady]);

  // ── Init MapLibre ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE as any,
      center: [2.3, 46.6],
      zoom: 5.5,
    });

    // Canvas overlay POI circles — inséré APRÈS le canvas MapLibre (avant les contrôles)
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1';
    mapContainerRef.current.appendChild(overlay);
    canvasOverlayRef.current = overlay;

    // Dessin des cercles POI à chaque frame (pan, zoom, données)
    map.on('render', () => {
      const data = zoneDataRef.current;
      const c = canvasOverlayRef.current;
      const container = mapContainerRef.current;
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
          // Rayon en pixels = rayon_metres / (mètres par pixel à ce zoom et cette latitude)
          const zoom = map.getZoom();
          const metersPerPx = (156543.03 * Math.cos(p.lat * Math.PI / 180)) / Math.pow(2, zoom);
          const rPx = rM / metersPerPx;
          if (rPx < 1) continue;

          const color = getCatColor(p.categorie);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, rPx, 0, 2 * Math.PI);
          ctx.fillStyle = color + '1e'; // ~12% opacité
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        } catch {
          // projection hors vue — skip
        }
      }
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    map.on('load', () => {
      // Zone globale (autour de la ville)
      map.addSource('zone-circle', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone-circle', paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'zone-outline', type: 'line', source: 'zone-circle', paint: { 'line-color': '#a78bfa', 'line-width': 2, 'line-dasharray': [4, 3] } });

      // Voronoï layer (polygones de zones d'influence)
      map.addSource('voronoi', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'voronoi-fill', type: 'fill', source: 'voronoi',
        paint: {
          'fill-color': ['get', 'voronoi_color'] as unknown as maplibregl.ExpressionSpecification,
          // Opacité : 0.35 au repos, 0.50 au survol — vitrail laser, carte lisible en dessous
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.50, 0.35] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'voronoi-line', type: 'line', source: 'voronoi',
        paint: {
          // Séparation blanche ultra-fine entre zones — effet puzzle/vitrail
          'line-color': '#ffffff',
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 1.2, 0.3] as unknown as maplibregl.ExpressionSpecification,
          'line-opacity': 0.9,
        },
        layout: { visibility: 'none' },
      });

      // Popup clic sur les cellules Voronoï
      map.on('click', 'voronoi-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const html = `
          <div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:220px">
            <b style="color:#1e293b">${props.nom ?? '—'}</b><br/>
            <span style="color:#64748b;font-size:11px">${props.adresse ?? ''}</span>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px">${props.ville ?? ''}</div>
          </div>
        `;
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      // Hover interactif sur les polygones Voronoï (feature-state → opacité + bordure)
      let voronoiHoveredId: number | null = null;
      map.on('mousemove', 'voronoi-fill', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features?.length) return;
        const fid = e.features[0].id as number;
        if (fid !== undefined && fid !== voronoiHoveredId) {
          if (voronoiHoveredId !== null) {
            map.setFeatureState({ source: 'voronoi', id: voronoiHoveredId }, { hover: false });
          }
          voronoiHoveredId = fid;
          map.setFeatureState({ source: 'voronoi', id: fid }, { hover: true });
        }
      });
      map.on('mouseleave', 'voronoi-fill', () => {
        map.getCanvas().style.cursor = '';
        if (voronoiHoveredId !== null) {
          map.setFeatureState({ source: 'voronoi', id: voronoiHoveredId }, { hover: false });
          voronoiHoveredId = null;
        }
      });

      // POI markers Voronoï (points des établissements)
      map.addSource('voronoi-pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'voronoi-pois-circle', type: 'circle', source: 'voronoi-pois',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 7, 5] as unknown as maplibregl.ExpressionSpecification,
          'circle-color': '#ef4444',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1,
          'circle-pitch-alignment': 'map',
        },
        layout: { visibility: 'none' },
      });
      // Halo lumineux derrière les points POI Voronoï
      map.addLayer({
        id: 'voronoi-pois-halo', type: 'circle', source: 'voronoi-pois',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 16, 12] as unknown as maplibregl.ExpressionSpecification,
          'circle-color': '#ffffff',
          'circle-opacity': 0.3,
          'circle-blur': 1,
          'circle-pitch-alignment': 'map',
        },
        layout: { visibility: 'none' },
      }, 'voronoi-pois-circle');
      // Popup clic sur les POI Voronoï
      map.on('click', 'voronoi-pois-circle', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        const html = `
          <div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:240px">
            <b style="color:#1e293b">${p.nom ?? '—'}</b><br/>
            <span style="color:#64748b;font-size:11px">${p.adresse ?? ''}</span>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px">${p.ville ?? ''}</div>
          </div>
        `;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      // Hover sur les POI Voronoï (agrandissement au survol)
      let voronoiPoiHoveredId: number | null = null;
      map.on('mousemove', 'voronoi-pois-circle', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features?.length) return;
        const fid = e.features[0].id as number;
        if (fid !== voronoiPoiHoveredId) {
          if (voronoiPoiHoveredId !== null) {
            map.setFeatureState({ source: 'voronoi-pois', id: voronoiPoiHoveredId }, { hover: false });
          }
          voronoiPoiHoveredId = fid;
          map.setFeatureState({ source: 'voronoi-pois', id: fid }, { hover: true });
        }
      });
      map.on('mouseleave', 'voronoi-pois-circle', () => {
        map.getCanvas().style.cursor = '';
        if (voronoiPoiHoveredId !== null) {
          map.setFeatureState({ source: 'voronoi-pois', id: voronoiPoiHoveredId }, { hover: false });
          voronoiPoiHoveredId = null;
        }
      });

      // Isochrones layer (empty initially)
      map.addSource('isochrones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'isochrones-fill', type: 'fill', source: 'isochrones',
        paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.18 },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'isochrones-line', type: 'line', source: 'isochrones',
        paint: { 'line-color': '#16a34a', 'line-width': 2, 'line-opacity': 0.85 },
        layout: { visibility: 'none' },
      });

      // Carreaux layer (empty initially)
      map.addSource('carreaux', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'carreaux-fill', type: 'fill', source: 'carreaux',
        paint: { 'fill-color': '#6baed6', 'fill-opacity': 0.35 },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'carreaux-line', type: 'line', source: 'carreaux',
        paint: { 'line-color': '#2171b5', 'line-width': 1, 'line-opacity': 0.6 },
        layout: { visibility: 'none' },
      });

      // ── Test ORS (validation polygones routiers bruts) ────────────────────
      map.addSource('test-iso', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'test-iso-fill', type: 'fill', source: 'test-iso',
        paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.5 },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'test-iso-line', type: 'line', source: 'test-iso',
        paint: { 'line-color': '#1d4ed8', 'line-width': 2, 'line-opacity': 0.9 },
        layout: { visibility: 'none' },
      });
      // Popup CIRFA sur clic
      map.on('click', 'test-iso-fill', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6">
              <b style="color:#1e293b">${p.cirfa_nom ?? '—'}</b><br/>
              <span style="color:#2563eb;font-weight:600">⏱ ${p.minutes_req ?? '?'} min (${p.mode ?? '?'})</span><br/>
              <span style="color:#94a3b8;font-size:10px">id: ${p.cirfa_id ?? '?'}</span>
            </div>
          `)
          .addTo(map);
      });

      // ── Bataille d'Isochrones layers ──────────────────────────────────────
      // Source A : anneaux (un feature par CIRFA par palier)
      map.addSource('battle-rings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      // Fill avec opacité décroissante par palier (battle_opacity calculé en TS)
      map.addLayer({
        id: 'battle-fill', type: 'fill', source: 'battle-rings',
        paint: {
          'fill-color':   ['get', 'battle_color']  as unknown as maplibregl.ExpressionSpecification,
          'fill-opacity': ['get', 'battle_opacity'] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });
      // Ligne fine entre anneaux (séparation paliers)
      map.addLayer({
        id: 'battle-ring-line', type: 'line', source: 'battle-rings',
        paint: { 'line-color': 'rgba(0,0,0,0.15)', 'line-width': 0.5, 'line-opacity': 0.6 },
        layout: { visibility: 'none' },
      });

      // Source B : union par CIRFA (contour territoire total = bordure 3px noire)
      map.addSource('battle-borders', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'battle-cirfa-border', type: 'line', source: 'battle-borders',
        paint: {
          'line-color':   '#111827',  // quasi-noir
          'line-width':   3,
          'line-opacity': 0.85,
        },
        layout: { visibility: 'none' },
      });

      // Popup clic sur les anneaux
      map.on('click', 'battle-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props  = e.features[0].properties as Record<string, unknown>;
        const palier = Number(props.palier ?? 0);
        const html = `
          <div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:220px">
            <b style="color:#1e293b">${props.nom ?? '—'}</b><br/>
            <span style="color:#64748b;font-size:11px">${props.adresse ?? ''}</span>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px">${props.ville ?? ''}</div>
            <div style="margin-top:4px;font-weight:600;color:#059669">⏱ Anneau ${palier} min</div>
          </div>
        `;
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      // POI markers Bataille d'Isochrones
      map.addSource('battle-pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'battle-pois-circle', type: 'circle', source: 'battle-pois',
        paint: {
          'circle-radius': 5,
          'circle-color':  '#dc2626',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1,
          'circle-pitch-alignment': 'map',
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'battle-pois-halo', type: 'circle', source: 'battle-pois',
        paint: {
          'circle-radius':  12,
          'circle-color':   '#ffffff',
          'circle-opacity': 0.3,
          'circle-blur':    1,
          'circle-pitch-alignment': 'map',
        },
        layout: { visibility: 'none' },
      }, 'battle-pois-circle');

      map.on('click', 'battle-pois-circle', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        const html = `
          <div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:240px">
            <b style="color:#1e293b">${p.nom ?? '—'}</b><br/>
            <span style="color:#64748b;font-size:11px">${p.adresse ?? ''}</span>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px">${p.ville ?? ''}</div>
          </div>
        `;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      // Click popup for carreaux
      map.on('click', 'carreaux-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const commune = props.commune || props.libelle_iris || '—';
        const pop = props.population ?? '—';
        const html = `
          <div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.5;max-width:220px">
            <b style="color:#1e40af">${commune}</b><br/>
            <span style="color:#64748b;font-size:11px">${props.libelle_iris || ''}</span>
            <div style="margin-top:4px">Pop: <b>${typeof pop === 'number' ? pop.toLocaleString('fr-FR') : pop}</b></div>
            ${props.departement ? `<span style="color:#94a3b8;font-size:11px">Dept. ${props.departement}</span>` : ''}
          </div>
        `;
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      overlay.remove();
      canvasOverlayRef.current = null;
    };
  }, []);

  // ── Mettre à jour la carte quand zoneData change ──────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !zoneData || !zoneData.coordonnees) return;

    const { lat, lng } = zoneData.coordonnees;

    // Nettoyer les anciens markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Cercle de zone globale (autour de la ville)
    (map.getSource('zone-circle') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: zoneData.rayon_metres
        ? [circleGeoJSON(lng, lat, zoneData.rayon_metres)]
        : [],
    });

    // Les cercles POI sont dessinés par map.on('render') via canvasOverlay
    // Forcer un repaint pour afficher immédiatement
    map.triggerRepaint();

    // Markers POI colorés par catégorie
    zoneData.pois.forEach((p) => {
      const color = getCatColor(p.categorie);

      const el = document.createElement('div');
      el.style.cssText = `width:10px;height:10px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4)`;

      const nom = (p.nom || 'POI').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
        `<div style="font-size:12px;padding:6px 8px">` +
        `<strong>${nom}</strong><br/>` +
        `<span style="color:${color};font-size:11px;font-weight:600;text-transform:uppercase">${p.categorie}</span>` +
        (p.sous_categorie ? ` <span style="color:#94a3b8;font-size:11px">· ${p.sous_categorie}</span>` : '') +
        (p.adresse ? `<br/><span style="color:#64748b;font-size:11px">📍 ${p.adresse}</span>` : '') +
        `</div>`
      );

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
    });

    // Marker ville (centre)
    const cityEl = document.createElement('div');
    cityEl.innerHTML = '📍';
    cityEl.style.cssText = 'font-size:24px;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
    const cityMarker = new maplibregl.Marker({ element: cityEl, anchor: 'bottom' })
      .setLngLat([lng, lat]).addTo(map);
    markersRef.current.push(cityMarker);

    const r = zoneData.rayon_metres;
    const rPoi = zoneData.rayon_poi_metres;

    // Zoom adapté selon le scope géographique
    let zoom: number;
    if (rPoi) {
      // Cercles POI : zoom en pour les voir
      zoom = rPoi < 300 ? 15 : rPoi < 800 ? 14 : rPoi < 2000 ? 13 : 12;
    } else if (r) {
      // Rayon autour de la ville
      zoom = r < 1500 ? 14 : r < 4000 ? 13 : 11;
    } else if (zoneData.pois.length > 1) {
      // Auto-fit : calculer le bounding box des POIs pour ajuster le zoom
      const lats = zoneData.pois.map(p => p.lat);
      const lngs = zoneData.pois.map(p => p.lng);
      const bounds = new maplibregl.LngLatBounds(
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
      );
      // fitBounds prend en charge le zoom automatiquement
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 1200 });
      return; // skip flyTo ci-dessous
    } else {
      zoom = 12;
    }

    map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, [zoneData, mapReady]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Toggle carreaux layer ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const vis = carreauxVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('carreaux-fill', 'visibility', vis);
      map.setLayoutProperty('carreaux-line', 'visibility', vis);
    } catch { /* layer not yet added */ }

    // Load data on first toggle
    if (carreauxVisible && !carreauxLoaded) {
      (async () => {
        try {
          // Get first carreaux source
          const listRes = await fetch('/api/carreaux');
          const listData = await listRes.json();
          if (!listData.sources || listData.sources.length === 0) return;

          const tableName = listData.sources[0].tableName;
          const gjRes = await fetch('/api/carreaux', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName }),
          });
          const gjData = await gjRes.json();
          if (!gjData.features) return;

          carreauxDataRef.current = gjData as GeoJSON.FeatureCollection;
          setCarreauxLoaded(true);

          const source = map.getSource('carreaux') as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData(gjData as GeoJSON.FeatureCollection);

            // Simple choropleth — pick first numeric property (skip x, y, idcar)
            const skipKeys = new Set(['idcar', 'x', 'y', 'gml_id', 'objectid']);
            let choroKey = '';
            const sampleProps = (gjData.features[0]?.properties || {}) as Record<string, unknown>;
            for (const [k, v] of Object.entries(sampleProps)) {
              if (skipKeys.has(k)) continue;
              if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '')) {
                choroKey = k;
                break;
              }
            }
            if (choroKey) {
              const vals = gjData.features
                .map((f: GeoJSON.Feature) => Number((f.properties as Record<string, unknown>)?.[choroKey]))
                .filter((n: number) => !isNaN(n));
              const mn = Math.min(...vals);
              const mx = Math.max(...vals);
              if (mx > mn) {
                const step = (mx - mn) / 4;
                map.setPaintProperty('carreaux-fill', 'fill-color', [
                  'interpolate', ['linear'],
                  ['coalesce', ['to-number', ['get', choroKey], 0], 0],
                  mn, '#f7fbff',
                  mn + step, '#c6dbef',
                  mn + 2 * step, '#6baed6',
                  mn + 3 * step, '#2171b5',
                  mx, '#08306b',
                ] as unknown as maplibregl.ExpressionSpecification);
              }
              console.log(`[Copilote] Choropleth metric: ${choroKey} [${mn}..${mx}]`);
            }
          }
          console.log(`[Copilote] Carreaux loaded: ${gjData.features.length} features`);
        } catch (err) {
          console.error('[Copilote] carreaux error:', err);
        }
      })();
    }
  }, [carreauxVisible, carreauxLoaded, mapReady]);

  // ── Envoi du message ───────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setError(null);
    lastUserMessageRef.current = text;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.reply ?? '',
        zoneData: data.zoneData ?? undefined,
        carreauxData: data.carreauxData ?? undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      if (data.zoneData) setZoneData(data.zoneData);
      if (data.carreauxData) {
        loadCarreauxFromAI(data.carreauxData);
        // Stocker la config carreaux pour sauvegarde
        const sources = carreauxSourcesRef.current;
        if (sources.length > 0) {
          carreauxConfigForSaveRef.current = {
            tableName:       sources[0].tableName,
            indicateur:      data.carreauxData.indicateur,
            indicateur_label: data.carreauxData.indicateur_label,
            coordonnees:     data.carreauxData.coordonnees,
          };
        }
      }
      if (data.isochroneData?.features?.length > 0) applyIsochrones(data.isochroneData);
      if (data.voronoiData?.features?.length > 0)   applyVoronoi(data.voronoiData);
      if (data.battleData?.features?.length > 0)    applyIsochroneBattle(
        data.battleData,
        data.battleBordersData ?? null,
        data.battleData._meta?.category
      );
      // Afficher l'erreur battle directement (sans attendre la paraphrase de Mistral)
      if (data.battleError) {
        console.error('[copilote] Erreur Bataille:', data.battleError);
        setError(`⚔️ Bataille d'Isochrones — Erreur : ${data.battleError}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Recalcul forcé de l'isochrone (bypass cache) ─────────────────────────
  const recalculerIsochrone = async () => {
    const lastMsg = lastUserMessageRef.current;
    if (!lastMsg || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: '♻️ Recalcul de l\'isochrone...' };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);
    setIsochroneFromCache(false);

    try {
      // Re-envoie le dernier message avec forceRecalculate=true
      const contextMessages = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(({ role, content }) => ({ role, content }));
      // Ajoute une instruction explicite pour recalculer
      contextMessages.push({ role: 'user', content: lastMsg });

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: contextMessages, forceRecalculate: true }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.reply ?? 'Isochrone recalculé.',
        zoneData: data.zoneData ?? undefined,
        carreauxData: data.carreauxData ?? undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (data.zoneData) setZoneData(data.zoneData);
      if (data.isochroneData?.features?.length > 0) applyIsochrones(data.isochroneData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Sauvegarder la carte courante ─────────────────────────────────────────
  const saveCurrentMap = async () => {
    if (!saveName.trim()) { setSaveError('Entrez un nom pour cette carte'); return; }
    setSaveLoading(true);
    setSaveError(null);

    try {
      const res = await fetch('/api/saved-maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            saveName.trim(),
          zone_data:       zoneData ?? undefined,
          carreaux_config: carreauxConfigForSaveRef.current ?? undefined,
          isochrone_data:  isochroneDataForSaveRef.current ?? undefined,
          voronoi_data:    voronoiDataForSaveRef.current ?? undefined,
          messages:        messages.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSaveName('');
      setShowSavePanel(false);
      // Recharger la liste
      loadSavedMaps();
      console.log(`[Copilote] Carte sauvegardée: "${saveName}" (${data.id})`);
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaveLoading(false);
    }
  };

  // ── Charger la liste des cartes sauvegardées ──────────────────────────────
  const loadSavedMaps = async () => {
    try {
      const res = await fetch('/api/saved-maps');
      const data = await res.json();
      setSavedMaps(data.maps ?? []);
    } catch { /* silencieux */ }
  };

  // ── Charger une carte sauvegardée ─────────────────────────────────────────
  const loadMap = async (id: string) => {
    try {
      const res = await fetch(`/api/saved-maps/${id}`);
      const data = await res.json();
      if (data.error) return;

      // Restaurer messages
      if (Array.isArray(data.messages)) {
        setMessages(data.messages as ChatMessage[]);
      }
      // Restaurer zone data
      if (data.zone_data) {
        setZoneData(data.zone_data);
      }
      // Restaurer carreaux
      if (data.carreaux_config) {
        const cc = data.carreaux_config;
        carreauxConfigForSaveRef.current = cc;
        await loadCarreauxFromAI({
          action: 'afficher_carreaux',
          indicateur:      cc.indicateur,
          indicateur_label: cc.indicateur_label,
          coordonnees:     cc.coordonnees,
        });
      }
      // Restaurer isochrones
      if (data.isochrone_data?.features?.length > 0) {
        applyIsochrones(data.isochrone_data);
      }
      // Restaurer Voronoï
      if (data.voronoi_data?.features?.length > 0) {
        applyVoronoi(data.voronoi_data);
      }

      setShowLoadPanel(false);
      console.log(`[Copilote] Carte chargée: "${data.name}"`);
    } catch (err) {
      console.error('[Copilote] Erreur chargement carte:', err);
    }
  };

  // ── Supprimer une carte sauvegardée ──────────────────────────────────────
  const deleteMap = async (id: string) => {
    await fetch(`/api/saved-maps?id=${id}`, { method: 'DELETE' });
    setSavedMaps(prev => prev.filter(m => m.id !== id));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Légende catégories (depuis les données affichées)
  const activeCats = zoneData?.categories
    ? Object.keys(zoneData.categories).sort()
    : [];

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#0a0a1a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Panneau CHAT ── */}
      <div style={{ width: 400, minWidth: 360, display: 'flex', flexDirection: 'column', background: '#0f0f23', borderRight: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/map" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 20, lineHeight: 1, fontWeight: 300 }}>←</Link>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Copilote Media</span>
              <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', background: 'rgba(124,58,237,0.3)', color: '#a78bfa', padding: '2px 6px', borderRadius: 4 }}>BETA</span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Mistral · function calling · poi_france</div>
          </div>
          {/* Boutons Save / Load */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); setSaveError(null); }}
              title="Sauvegarder la carte actuelle"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 8px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >💾</button>
            <button
              onClick={() => { setShowLoadPanel(v => !v); setShowSavePanel(false); if (!showLoadPanel) loadSavedMaps(); }}
              title="Charger une carte sauvegardée"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 8px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >📁</button>
          </div>
          {isLoading && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3dffa0', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />}
        </div>

        {/* Panel Sauvegarder */}
        {showSavePanel && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(124,58,237,0.08)' }}>
            <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600, marginBottom: 8 }}>💾 Sauvegarder cette carte</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveCurrentMap()}
                placeholder="Nom de la carte…"
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '7px 10px', color: '#fff', fontSize: 12, outline: 'none' }}
              />
              <button
                onClick={saveCurrentMap}
                disabled={saveLoading || !saveName.trim()}
                style={{ background: saveName.trim() && !saveLoading ? '#7c3aed' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 7, padding: '7px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >{saveLoading ? '…' : 'Sauvegarder'}</button>
            </div>
            {saveError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {saveError}</div>}
          </div>
        )}

        {/* Panel Charger */}
        {showLoadPanel && (
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)', maxHeight: 240, overflowY: 'auto' }}>
            <div style={{ padding: '10px 16px', fontSize: 12, color: '#a78bfa', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              📁 Cartes sauvegardées ({savedMaps.length})
            </div>
            {savedMaps.length === 0 ? (
              <div style={{ padding: '16px', fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>Aucune carte sauvegardée</div>
            ) : (
              savedMaps.map(m => (
                <div key={m.id} style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                      {m.ville && `📍 ${m.ville} · `}{m.nb_pois > 0 && `${m.nb_pois} POI · `}
                      {new Date(m.created_at).toLocaleDateString('fr-FR')}
                    </div>
                  </div>
                  <button onClick={() => loadMap(m.id)} style={{ background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)', borderRadius: 6, padding: '4px 10px', color: '#a78bfa', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>Charger</button>
                  <button onClick={() => deleteMap(m.id)} title="Supprimer" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '4px 6px', color: '#f87171', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>🗑</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Accueil */}
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🗺️</div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Décrivez votre cible</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
                Ex : <em>&ldquo;Lycées CSP+ à Lyon dans un rayon de 3km&rdquo;</em>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { icon: '📍', text: 'Lycées et CIRFA à Brest' },
                  { icon: '📊', text: 'Lycées à Brest + où vivent les 18-24 ans' },
                  { icon: '⏱', text: 'Isochrone 5 min à pied autour des lycées à Brest' },
                  { icon: '⏱', text: 'Zone 15 min voiture autour des CIRFA de Lyon' },
                ].map(({ icon, text }) => (
                  <button key={text} onClick={() => sendMessage(text)} style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '9px 12px', color: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer', fontSize: 12, textAlign: 'left', transition: 'background 0.15s',
                  }}>
                    {icon} {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Liste messages */}
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: '82%', background: '#7c3aed', color: '#fff', borderRadius: '14px 14px 4px 14px', padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
                    {msg.content}
                  </div>
                </div>
              )}

              {msg.role === 'assistant' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(61,255,160,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>🤖</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {msg.zoneData && <ZoneCard zone={msg.zoneData} />}
                    {msg.content && (
                      <div style={{ marginTop: msg.zoneData ? 10 : 0, background: 'rgba(255,255,255,0.05)', borderRadius: '4px 14px 14px 14px', padding: '10px 14px', fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.6 }}>
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {isLoading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(61,255,160,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🤖</div>
              <TypingDots />
            </div>
          )}

          {/* Erreur */}
          {error && (
            <div style={{ background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ff5757', fontFamily: 'JetBrains Mono, monospace' }}>
              ⚠ Erreur : {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Décrivez votre cible : ville, type d'établissement, rayon…"
              rows={2}
              style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              style={{ background: input.trim() && !isLoading ? '#7c3aed' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: '10px 16px', color: input.trim() && !isLoading ? '#fff' : 'rgba(255,255,255,0.3)', cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed', fontSize: 18, lineHeight: 1, transition: 'background 0.2s', flexShrink: 0 }}
            >
              ↑
            </button>
          </form>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 8, textAlign: 'center' }}>
            Entrée pour envoyer · Shift+Entrée pour nouvelle ligne
          </div>
        </div>
      </div>

      {/* ── Panneau CARTE ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#e8e8e8', position: 'relative' }} />

        {/* Badge zone active */}
        {zoneData && (
          <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', zIndex: 10 }}>
            <div style={{ color: '#4f46e5', fontWeight: 700, marginBottom: 2 }}>📍 {zoneData.ville}</div>
            <div style={{ color: '#64748b' }}>
              {zoneData.rayon_metres ? `rayon ${(zoneData.rayon_metres / 1000).toFixed(1)} km · ` : ''}{zoneData.nb_pois} établissements
            </div>
          </div>
        )}

        {/* Badge isochrone actif + notification cache */}
        {isochroneVisible && isochroneMinutes > 0 && (
          <div style={{
            position: 'absolute', top: 16, left: zoneData ? 130 : 16, zIndex: 10,
            background: `${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).fill}e6`,
            backdropFilter: 'blur(4px)',
            border: `1px solid ${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line}`,
            borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#fff',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              ⏱ {isochroneMinutes}min — {ISOCHRONE_MODE_LABELS[isochroneMode] ?? isochroneMode}
              {isochroneFromCache && <span style={{ opacity: 0.75, fontSize: 10 }}>♻️ cache</span>}
              <button onClick={() => setIsochroneVisible(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1, opacity: 0.8 }}>✕</button>
            </div>
            {/* Notification cache : date + bouton recalculer */}
            {isochroneFromCache && isochroneCachedAt && (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, opacity: 0.9 }}>
                <span>Calculé le {new Date(isochroneCachedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <button
                  onClick={recalculerIsochrone}
                  disabled={isLoading}
                  style={{ background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 4, padding: '2px 6px', color: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}
                >Recalculer</button>
              </div>
            )}
          </div>
        )}

        {/* Badge Voronoï actif */}
        {voronoiVisible && voronoiCategory && (
          <div style={{
            position: 'absolute', top: isochroneVisible && isochroneMinutes > 0 ? 90 : 56, left: 16, zIndex: 10,
            background: 'rgba(217,119,6,0.9)', backdropFilter: 'blur(4px)',
            border: '1px solid #f59e0b', borderRadius: 8,
            padding: '5px 10px', fontSize: 11, color: '#fff',
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>◆ Voronoï — {voronoiCategory}</span>
            <button
              onClick={() => setVoronoiVisible(false)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1, opacity: 0.8 }}
            >✕</button>
          </div>
        )}

        {/* Badge indicateur carreaux actif */}
        {carreauxVisible && carreauxLabel && (
          <div style={{
            position: 'absolute', top: 56, right: 16, zIndex: 10,
            background: 'rgba(33,113,181,0.92)', backdropFilter: 'blur(4px)',
            border: '1px solid rgba(33,113,181,0.6)', borderRadius: 8,
            padding: '5px 10px', fontSize: 11, color: '#fff',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            📊 {carreauxLabel}
          </div>
        )}

        {/* Voronoï toggle */}
        {voronoiCategory && (
          <button
            onClick={() => setVoronoiVisible(v => !v)}
            title={voronoiVisible ? 'Masquer le Voronoï' : 'Afficher le Voronoï'}
            style={{
              position: 'absolute', top: 52, right: 16, zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 6,
              background: voronoiVisible ? 'rgba(217,119,6,0.9)' : 'rgba(255,255,255,0.9)',
              border: `1px solid ${voronoiVisible ? '#d97706' : 'rgba(0,0,0,0.15)'}`,
              borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
              fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
              color: voronoiVisible ? '#fff' : '#64748b',
              backdropFilter: 'blur(4px)', transition: 'all 0.2s',
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: 2,
              background: voronoiVisible ? '#fff' : '#f59e0b',
              border: `1.5px solid ${voronoiVisible ? '#fff' : '#d97706'}`,
            }} />
            Voronoï
          </button>
        )}

        {/* Bataille d'Isochrones toggle */}
        {battleCategory && (
          <button
            onClick={() => setBattleVisible(v => !v)}
            title={battleVisible ? 'Masquer la Bataille' : 'Afficher la Bataille d\'Isochrones'}
            style={{
              position: 'absolute', top: 88, right: 16, zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 6,
              background: battleVisible ? 'rgba(220,38,38,0.9)' : 'rgba(255,255,255,0.9)',
              border: `1px solid ${battleVisible ? '#dc2626' : 'rgba(0,0,0,0.15)'}`,
              borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
              fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
              color: battleVisible ? '#fff' : '#64748b',
              backdropFilter: 'blur(4px)', transition: 'all 0.2s',
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: 2,
              background: battleVisible ? '#fff' : '#ef4444',
              border: `1.5px solid ${battleVisible ? '#fff' : '#dc2626'}`,
            }} />
            Bataille
          </button>
        )}

        {/* Carreaux toggle */}
        <button
          onClick={() => setCarreauxVisible(v => !v)}
          title={carreauxVisible ? 'Masquer les carreaux' : 'Afficher les carreaux démographiques'}
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            background: carreauxVisible ? 'rgba(33,113,181,0.9)' : 'rgba(255,255,255,0.9)',
            border: `1px solid ${carreauxVisible ? '#2171b5' : 'rgba(0,0,0,0.15)'}`,
            borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            color: carreauxVisible ? '#fff' : '#64748b',
            backdropFilter: 'blur(4px)', transition: 'all 0.2s',
          }}
        >
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            background: carreauxVisible ? '#fff' : '#6baed6',
            border: `1.5px solid ${carreauxVisible ? '#fff' : '#2171b5'}`,
            opacity: carreauxVisible ? 0.8 : 0.6,
          }} />
          Carreaux {carreauxLoaded ? '✓' : ''}
        </button>

        {/* Légende catégories */}
        {activeCats.length > 0 && (
          <div style={{ position: 'absolute', bottom: 48, left: 16, background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#64748b', zIndex: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {activeCats.map((cat) => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: getCatColor(cat), border: '2px solid rgba(255,255,255,0.9)', flexShrink: 0 }} />
                <span>{cat} ({zoneData!.categories[cat]})</span>
              </div>
            ))}
            {zoneData!.rayon_metres && (
              <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(99,102,241,0.25)', borderRadius: 2, border: '1.5px dashed #6366f1', flexShrink: 0 }} />
                Zone {(zoneData!.rayon_metres / 1000).toFixed(1)} km
              </div>
            )}
            {zoneData!.rayon_poi_metres && (
              <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(16,185,129,0.15)', borderRadius: '50%', border: '1.5px solid #10b981', flexShrink: 0 }} />
                Rayon {zoneData!.rayon_poi_metres >= 1000 ? `${(zoneData!.rayon_poi_metres/1000).toFixed(1)} km` : `${zoneData!.rayon_poi_metres} m`} / POI
              </div>
            )}
            {isochroneVisible && isochroneMinutes > 0 && (
              <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: `${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).fill}40`, borderRadius: 2, border: `1.5px solid ${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line}`, flexShrink: 0 }} />
                Isochrone {isochroneMinutes}min ({ISOCHRONE_MODE_LABELS[isochroneMode] ?? isochroneMode})
              </div>
            )}
            {voronoiVisible && voronoiCategory && (() => {
              const regionLabel = voronoiDataForSaveRef.current?._meta?.filtre_region
                ?? voronoiDataForSaveRef.current?._meta?.filtre_ville
                ?? voronoiDataForSaveRef.current?._meta?.filtre_dept
                ?? null;
              return (
                <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {/* En-tête avec bouton sauvegarder intégré */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, background: (voronoiCirfas[0]?.color ?? '#d97706') + '55', borderRadius: 2, border: `1.5px solid ${voronoiCirfas[0]?.color ?? '#d97706'}`, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 10 }}>
                        Voronoï — {voronoiCategory}{regionLabel ? ` · ${regionLabel}` : ''}
                      </span>
                    </div>
                    {/* Bouton sauvegarder rapide */}
                    <button
                      onClick={() => { setShowSavePanel(true); setShowLoadPanel(false); setSaveError(null); }}
                      title="Sauvegarder ce Voronoï"
                      style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 5, padding: '2px 6px', fontSize: 10, color: '#7c3aed', cursor: 'pointer', fontWeight: 600, lineHeight: 1.4, flexShrink: 0 }}
                    >💾 Sauver</button>
                  </div>
                  {/* Légende des secteurs : un carré couleur + nom par CIRFA */}
                  {voronoiCirfas.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, background: c.color + '55', borderRadius: 2, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: '#1e293b', fontWeight: 500 }}>{c.nom}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {battleVisible && battleCategory && (
              <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#ef444455', borderRadius: 2, border: '1.5px solid #dc2626', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 10 }}>
                    Bataille — {battleCategory}
                  </span>
                </div>
                {/* Gradient paliers */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                  {[10, 30, 60, 90, 120, 150].map(p => (
                    <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                      <span style={{ display: 'inline-block', width: 14, height: 8, background: `rgba(239,68,68,${BATTLE_PALIER_OPACITY[p]})`, borderRadius: 2, border: '1px solid rgba(0,0,0,0.2)' }} />
                      <span style={{ fontSize: 8, color: '#94a3b8' }}>{p}m</span>
                    </div>
                  ))}
                </div>
                {/* Liste CIRFAs */}
                {battleCirfas.slice(0, 8).map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: c.color + '55', borderRadius: 2, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: '#1e293b', fontWeight: 500 }}>{c.nom}</span>
                  </div>
                ))}
                {battleCirfas.length > 8 && (
                  <span style={{ fontSize: 9, color: '#94a3b8' }}>+{battleCirfas.length - 8} autres…</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Bouton Test ORS (preuve isochrone routier réel) ── */}
        <div style={{ position: 'absolute', bottom: 90, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 290 }}>
          <button
            onClick={() => runTestIsochrone('Bretagne', 'cirfa', 10, 'drive')}
            disabled={testIsoLoading}
            style={{
              background:    testIsoVisible ? '#2563eb' : 'rgba(255,255,255,0.95)',
              border:        '2px solid #2563eb',
              borderRadius:  8,
              padding:       '8px 14px',
              cursor:        testIsoLoading ? 'wait' : 'pointer',
              fontSize:      11,
              fontFamily:    'JetBrains Mono, monospace',
              color:         testIsoVisible ? '#fff' : '#2563eb',
              fontWeight:    600,
              boxShadow:     '0 2px 8px rgba(37,99,235,0.18)',
              transition:    'all 0.2s',
            }}
          >
            {testIsoLoading ? '⏳ Appel ORS…' : testIsoVisible ? '✅ ORS 10min visible' : '🔵 Test ORS 10min Bretagne'}
          </button>
          {testIsoDebug && (
            <div style={{
              background:  'rgba(0,0,0,0.78)',
              color:       '#e2e8f0',
              padding:     '5px 9px',
              borderRadius: 6,
              fontSize:    10,
              fontFamily:  'JetBrains Mono, monospace',
              lineHeight:  1.45,
              wordBreak:   'break-word',
            }}>
              {testIsoDebug}
            </div>
          )}
        </div>

        {/* Légende par défaut (avant résultats) */}
        {activeCats.length === 0 && (
          <div style={{ position: 'absolute', bottom: 48, left: 16, background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: '7px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#64748b', zIndex: 10 }}>
            <div style={{ color: '#94a3b8', fontSize: 10 }}>Décrivez une zone pour commencer</div>
          </div>
        )}
      </div>

      {/* Animations */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        @keyframes bounce { 0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)} }
        .maplibregl-popup-content { background:#fff!important;border:none!important;padding:0!important;box-shadow:0 2px 8px rgba(0,0,0,0.15)!important;border-radius:8px!important; }
      `}</style>
    </div>
  );
}
