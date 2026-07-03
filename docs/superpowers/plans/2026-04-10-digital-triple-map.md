# Digital Triple Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page plein écran `/map/analyse/digital` avec 3 cartes MapLibre synchronisées : Impressions / Population / Ratio — alimentées par 1 seul fetch GeoJSON.

**Architecture:** 1 page Next.js client-only, 3 instances MapLibre synchronisées via `syncMove`, 1 barre de contrôle en haut (campagne + échelle + palette). Le GeoJSON est fetché une fois depuis `/api/digital/[campaignId]/map`, puis chaque carte utilise un attribut différent pour sa paint expression (`impressions`, `pop_total`, `imp_pour_mille`).

**Tech Stack:** Next.js 14 App Router, MapLibre GL JS, TypeScript strict, MAGELIAN design system (dark minimal, Inter + JetBrains Mono, teal #4ecdc4)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `app/map/analyse/digital/page.tsx` | Page component — layout, state, data fetch, 3 map containers |
| `app/map/analyse/digital/_components/DigitalToolbar.tsx` | Top toolbar — campaign select, scale toggle, palette picker, invert |
| `app/map/analyse/digital/_components/SyncMap.tsx` | Single MapLibre instance — receives GeoJSON + paint config, emits move events |
| `app/map/analyse/digital/_components/MapLegend.tsx` | Gradient legend below each map — title, gradient bar, min/max labels |
| `app/map/analyse/digital/_lib/palettes.ts` | DIGITAL_PALETTES + divergent palette for ratio + helper to build paint expression |
| `app/map/analyse/digital/_lib/use-digital-data.ts` | Hook: fetch campaigns list + GeoJSON, compute percentiles |

Auth is inherited from `app/map/layout.tsx` (Next.js nesting). No new auth code needed.

---

### Task 1: Palettes + paint expression helpers

**Files:**
- Create: `app/map/analyse/digital/_lib/palettes.ts`

- [ ] **Step 1: Create palettes module**

```typescript
// app/map/analyse/digital/_lib/palettes.ts

export const PALETTES = [
  { id: 'teal',    label: 'Teal',    stops: ['#0a0a0a','#16537e','#1e8a7a','#4ecdc4','#7eddd5','#f7fff7'] },
  { id: 'bleu',    label: 'Bleu',    stops: ['#F7FBFF','#C6DBEF','#9ECAE1','#4292C6','#2171B5','#08306B'] },
  { id: 'vert',    label: 'Vert',    stops: ['#F7FCF5','#C7E9C0','#74C476','#41AB5D','#238B45','#00441B'] },
  { id: 'chaleur', label: 'Chaleur', stops: ['#FAEEDA','#FAC775','#EF9F27','#D85A30','#993C1D','#501313'] },
  { id: 'rouge',   label: 'Rouge',   stops: ['#FFF5F0','#FEE0D2','#FCBBA1','#FC9272','#DE2D26','#A50F15'] },
  { id: 'turbo',   label: 'Turbo',   stops: ['#30123b','#4675ed','#1bcfd4','#61fc6c','#f6a91b','#c42503'] },
  { id: 'plasma',  label: 'Plasma',  stops: ['#0d0887','#6a00a8','#b12a90','#e16462','#fca636','#f0f921'] },
];

/** Divergent palette for ratio map (red = under-served, grey = balanced, blue = over-served) */
export const RATIO_PALETTE = {
  id: 'ratio',
  label: 'Ratio',
  stops: ['#b2182b','#ef8a62','#fddbc7','#f7f7f7','#d1e5f0','#67a9cf','#2166ac'],
};

export interface Percentiles {
  p10: number; p25: number; p50: number; p75: number; p90: number; max: number;
}

/** Compute percentiles from sorted positive values */
export function computePercentiles(values: number[]): Percentiles {
  if (values.length === 0) return { p10: 0, p25: 1, p50: 10, p75: 100, p90: 1000, max: 10000 };
  const sorted = [...values].filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { p10: 0, p25: 1, p50: 10, p75: 100, p90: 1000, max: 10000 };
  const pct = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  return { p10: pct(0.1), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p90: pct(0.9), max: sorted[sorted.length - 1] };
}

/** Build MapLibre fill-color expression from palette + percentiles */
export function buildFillExpression(
  attribute: string,
  stops: string[],
  percentiles: Percentiles,
  inverted: boolean
): unknown[] {
  const s = inverted ? [...stops].reverse() : stops;
  const pts = [percentiles.p10, percentiles.p25, percentiles.p50, percentiles.p75, percentiles.p90, percentiles.max];

  // Deduplicate: ensure strictly increasing values
  const pairs: (string | number)[] = [];
  let prev = -Infinity;
  for (let i = 0; i < Math.min(s.length, pts.length); i++) {
    if (pts[i] > prev) { pairs.push(pts[i], s[i]); prev = pts[i]; }
  }
  if (pairs.length < 4) { pairs.push(1, s[0], 1000, s[s.length - 1]); }

  return [
    'case',
    ['==', ['to-number', ['get', attribute], 0], 0], '#1a1a1a',
    ['interpolate', ['linear'], ['to-number', ['get', attribute], 0], ...pairs],
  ];
}
```

- [ ] **Step 2: Commit**

```bash
git add app/map/analyse/digital/_lib/palettes.ts
git commit -m "feat(digital-triple): palette helpers + paint expression builder"
```

---

### Task 2: Data fetch hook

**Files:**
- Create: `app/map/analyse/digital/_lib/use-digital-data.ts`

- [ ] **Step 1: Create the hook**

```typescript
// app/map/analyse/digital/_lib/use-digital-data.ts
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Campaign { id: string; name: string; total_tracked_ads: number; }

interface DigitalData {
  campaigns: Campaign[];
  campaignsLoading: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  geojsonLoading: boolean;
  fetchMap: (campaignId: string, scale: string) => Promise<void>;
}

export function useDigitalData(): DigitalData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geojsonLoading, setGeojsonLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch campaigns on mount
  useEffect(() => {
    fetch(`/api/digital/campaigns?_t=${Date.now()}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setCampaigns(data))
      .catch(() => {})
      .finally(() => setCampaignsLoading(false));
  }, []);

  const fetchMap = useCallback(async (campaignId: string, scale: string) => {
    if (!campaignId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setGeojsonLoading(true);
    try {
      const res = await fetch(
        `/api/digital/${campaignId}/map?bbox=-5.5,41.0,10.0,51.5&scale=${scale}`,
        { signal: ctrl.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json() as GeoJSON.FeatureCollection;
      setGeojson(fc);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error('[digital-data]', err);
    } finally {
      setGeojsonLoading(false);
    }
  }, []);

  return { campaigns, campaignsLoading, geojson, geojsonLoading, fetchMap };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/map/analyse/digital/_lib/use-digital-data.ts
git commit -m "feat(digital-triple): data fetch hook with abort"
```

---

### Task 3: SyncMap component

**Files:**
- Create: `app/map/analyse/digital/_components/SyncMap.tsx`

- [ ] **Step 1: Create the synchronized map component**

```typescript
// app/map/analyse/digital/_components/SyncMap.tsx
'use client';

import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { applyMagelianStyle } from '@/lib/map/magelian-style';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const FRANCE_CENTER: [number, number] = [2.3, 46.6];
const FRANCE_ZOOM = 5.5;

interface SyncMapProps {
  id: string;
  geojson: GeoJSON.FeatureCollection | null;
  fillExpression: unknown[];
  lineColor?: string;
  /** Called when this map moves — other maps should sync */
  onMove?: (center: [number, number], zoom: number, bearing: number, pitch: number) => void;
  /** Receive sync from another map */
  syncTarget?: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null;
}

export function SyncMap({ id, geojson, fillExpression, lineColor, onMove, syncTarget }: SyncMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isSyncing = useRef(false);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: FRANCE_CENTER,
      zoom: FRANCE_ZOOM,
      attributionControl: false,
    });

    map.on('load', () => {
      applyMagelianStyle(map);

      map.addSource(`digital-${id}`, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: `digital-fill-${id}`,
        type: 'fill',
        source: `digital-${id}`,
        paint: { 'fill-color': '#1a1a1a', 'fill-opacity': 0.7 },
      });

      map.addLayer({
        id: `digital-line-${id}`,
        type: 'line',
        source: `digital-${id}`,
        paint: {
          'line-color': lineColor ?? '#333333',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.5, 12, 1],
          'line-opacity': 0.4,
        },
      });
    });

    // Emit move events for sync
    const handleMove = () => {
      if (isSyncing.current) return;
      const c = map.getCenter();
      onMove?.([c.lng, c.lat], map.getZoom(), map.getBearing(), map.getPitch());
    };
    map.on('move', handleMove);

    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update GeoJSON data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geojson) return;
    const src = map.getSource(`digital-${id}`) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(geojson);
  }, [geojson, id]);

  // Update fill expression
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(`digital-fill-${id}`)) return;
    try {
      map.setPaintProperty(`digital-fill-${id}`, 'fill-color', fillExpression as maplibregl.ExpressionSpecification);
    } catch { /* layer not ready yet */ }
  }, [fillExpression, id]);

  // Sync from other maps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !syncTarget) return;
    isSyncing.current = true;
    map.jumpTo({
      center: syncTarget.center,
      zoom: syncTarget.zoom,
      bearing: syncTarget.bearing,
      pitch: syncTarget.pitch,
    });
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, [syncTarget]);

  // Hover popup
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layerId = `digital-fill-${id}`;
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '220px' });

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; popup.remove(); };
    const onMouseMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return;
      const p = e.features[0].properties;
      const imp = Number(p.impressions ?? 0);
      const pop = Number(p.pop_total ?? 0);
      const ratio = pop > 0 ? (imp / pop * 1000).toFixed(1) : '—';
      popup.setLngLat(e.lngLat).setHTML(`
        <div style="font-family:Inter,sans-serif;font-size:11px;color:#f0f0f0;background:#0a0a0a;padding:6px 8px;border-radius:4px;border:0.5px solid #262626">
          <div style="font-weight:500">${p.code ?? ''} — ${p.nom ?? ''}</div>
          <div style="color:#a0a0a0;margin-top:2px">Imp: <span style="color:#4ecdc4;font-family:JetBrains Mono,monospace">${imp.toLocaleString('fr-FR')}</span></div>
          <div style="color:#a0a0a0">Pop: <span style="color:#f0f0f0;font-family:JetBrains Mono,monospace">${pop.toLocaleString('fr-FR')}</span></div>
          <div style="color:#a0a0a0">Ratio: <span style="font-family:JetBrains Mono,monospace">${ratio}</span> /1000</div>
        </div>
      `).addTo(map);
    };

    const waitForLayer = () => {
      if (map.getLayer(layerId)) {
        map.on('mouseenter', layerId, onEnter);
        map.on('mouseleave', layerId, onLeave);
        map.on('mousemove', layerId, onMouseMove);
      }
    };
    if (map.isStyleLoaded()) waitForLayer();
    else map.on('load', waitForLayer);

    return () => {
      try {
        map.off('mouseenter', layerId, onEnter);
        map.off('mouseleave', layerId, onLeave);
        map.off('mousemove', layerId, onMouseMove);
      } catch { /* ok */ }
      popup.remove();
    };
  }, [id]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/map/analyse/digital/_components/SyncMap.tsx
git commit -m "feat(digital-triple): SyncMap component with hover + sync"
```

---

### Task 4: MapLegend component

**Files:**
- Create: `app/map/analyse/digital/_components/MapLegend.tsx`

- [ ] **Step 1: Create legend component**

```typescript
// app/map/analyse/digital/_components/MapLegend.tsx
'use client';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface MapLegendProps {
  title: string;
  stops: string[];
  minLabel: string;
  midLabel?: string;
  maxLabel: string;
}

export function MapLegend({ title, stops, minLabel, midLabel, maxLabel }: MapLegendProps) {
  return (
    <div style={{ padding: '8px 12px', background: '#0a0a0a', borderTop: '0.5px solid #1a1a1a' }}>
      <div style={{ fontFamily: fInter, fontSize: 10, fontWeight: 500, color: '#a0a0a0', marginBottom: 4 }}>{title}</div>
      <div style={{ height: 8, borderRadius: 3, background: `linear-gradient(to right, ${stops.join(', ')})` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontFamily: fMono, fontSize: 8, color: '#666666' }}>{minLabel}</span>
        {midLabel && <span style={{ fontFamily: fMono, fontSize: 8, color: '#666666' }}>{midLabel}</span>}
        <span style={{ fontFamily: fMono, fontSize: 8, color: '#666666' }}>{maxLabel}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/map/analyse/digital/_components/MapLegend.tsx
git commit -m "feat(digital-triple): MapLegend component"
```

---

### Task 5: DigitalToolbar component

**Files:**
- Create: `app/map/analyse/digital/_components/DigitalToolbar.tsx`

- [ ] **Step 1: Create toolbar**

```typescript
// app/map/analyse/digital/_components/DigitalToolbar.tsx
'use client';

import { PALETTES } from '../_lib/palettes';

const fInter = "'Inter', sans-serif";

const C = {
  bg: '#050505', card: '#0a0a0a', elevated: '#111111',
  border: '#1a1a1a', text: '#f0f0f0', textSec: '#a0a0a0', textDim: '#666666',
  teal: '#4ecdc4',
};

interface Campaign { id: string; name: string; total_tracked_ads: number; }

interface DigitalToolbarProps {
  campaigns: Campaign[];
  selectedCampaign: string;
  onCampaignChange: (id: string) => void;
  scale: string;
  onScaleChange: (s: string) => void;
  palette: string;
  onPaletteChange: (id: string) => void;
  inverted: boolean;
  onInvertedChange: (v: boolean) => void;
  loading: boolean;
  zonesCount: number;
  totalImpressions: number;
}

export function DigitalToolbar({
  campaigns, selectedCampaign, onCampaignChange,
  scale, onScaleChange,
  palette, onPaletteChange, inverted, onInvertedChange,
  loading, zonesCount, totalImpressions,
}: DigitalToolbarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px',
      background: C.card, borderBottom: `0.5px solid ${C.border}`,
      flexShrink: 0, flexWrap: 'wrap',
    }}>
      {/* Campaign */}
      <select
        value={selectedCampaign}
        onChange={e => onCampaignChange(e.target.value)}
        style={{
          background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 4,
          padding: '6px 10px', fontFamily: fInter, fontSize: 12, color: C.text, outline: 'none',
          minWidth: 200, cursor: 'pointer',
        }}
      >
        <option value="">Campagne</option>
        {campaigns.map(c => (
          <option key={c.id} value={c.id}>{c.name} — {c.total_tracked_ads?.toLocaleString('fr-FR')} imp.</option>
        ))}
      </select>

      {/* Scale */}
      <div style={{ display: 'flex', gap: 2 }}>
        {[
          { id: 'cp', label: 'CP' },
          { id: 'departement', label: 'Dept' },
          { id: 'region', label: 'Région' },
        ].map(s => (
          <button key={s.id} onClick={() => onScaleChange(s.id)} style={{
            padding: '5px 10px', fontSize: 11, fontFamily: fInter, cursor: 'pointer',
            background: scale === s.id ? 'rgba(78,205,196,0.12)' : 'transparent',
            border: `0.5px solid ${scale === s.id ? C.teal : C.border}`,
            borderRadius: 3, color: scale === s.id ? C.teal : C.textSec, transition: 'all 0.15s',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Palette */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {PALETTES.map(p => (
          <button key={p.id} onClick={() => onPaletteChange(p.id)} title={p.label} style={{
            width: 24, height: 12, borderRadius: 2, cursor: 'pointer', padding: 0,
            background: `linear-gradient(to right, ${p.stops.join(', ')})`,
            border: `1.5px solid ${palette === p.id ? '#f0f0f0' : 'transparent'}`,
          }} />
        ))}
      </div>

      {/* Invert */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, fontFamily: fInter, color: C.textDim }}>
        <input type="checkbox" checked={inverted} onChange={e => onInvertedChange(e.target.checked)} style={{ accentColor: C.teal }} />
        Inverser
      </label>

      {/* Stats */}
      {loading && <span style={{ fontFamily: fInter, fontSize: 11, color: C.teal }}>Chargement...</span>}
      {!loading && zonesCount > 0 && (
        <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, marginLeft: 'auto' }}>
          {zonesCount.toLocaleString('fr-FR')} zones · {totalImpressions.toLocaleString('fr-FR')} imp.
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/map/analyse/digital/_components/DigitalToolbar.tsx
git commit -m "feat(digital-triple): DigitalToolbar component"
```

---

### Task 6: Main page — triple map layout

**Files:**
- Create: `app/map/analyse/digital/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// app/map/analyse/digital/page.tsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import { SyncMap } from './_components/SyncMap';
import { MapLegend } from './_components/MapLegend';
import { DigitalToolbar } from './_components/DigitalToolbar';
import { useDigitalData } from './_lib/use-digital-data';
import { PALETTES, RATIO_PALETTE, computePercentiles, buildFillExpression } from './_lib/palettes';

const fInter = "'Inter', sans-serif";

export default function DigitalTripleMapPage() {
  const { campaigns, geojson, geojsonLoading, fetchMap } = useDigitalData();

  const [campaignId, setCampaignId] = useState('');
  const [scale, setScale] = useState('cp');
  const [palette, setPalette] = useState('teal');
  const [inverted, setInverted] = useState(false);

  // Sync state — shared between all 3 maps
  const [syncState, setSyncState] = useState<{
    center: [number, number]; zoom: number; bearing: number; pitch: number;
  } | null>(null);
  const [syncSource, setSyncSource] = useState<string | null>(null);

  const handleMove = useCallback((source: string) => (center: [number, number], zoom: number, bearing: number, pitch: number) => {
    setSyncSource(source);
    setSyncState({ center, zoom, bearing, pitch });
  }, []);

  // Load data when campaign or scale changes
  const handleCampaignChange = useCallback((id: string) => {
    setCampaignId(id);
    if (id) fetchMap(id, scale);
  }, [scale, fetchMap]);

  const handleScaleChange = useCallback((s: string) => {
    setScale(s);
    if (campaignId) fetchMap(campaignId, s);
  }, [campaignId, fetchMap]);

  // Compute percentiles from GeoJSON
  const stats = useMemo(() => {
    if (!geojson) return { impPerc: null, popPerc: null, ratioPerc: null, totalImp: 0 };
    const impValues = geojson.features.map(f => Number(f.properties?.impressions) || 0);
    const popValues = geojson.features.map(f => Number(f.properties?.pop_total) || 0);
    const ratioValues = geojson.features
      .map(f => Number(f.properties?.imp_pour_mille) || 0)
      .filter(v => v > 0);
    return {
      impPerc: computePercentiles(impValues),
      popPerc: computePercentiles(popValues),
      ratioPerc: computePercentiles(ratioValues),
      totalImp: impValues.reduce((a, b) => a + b, 0),
    };
  }, [geojson]);

  // Build paint expressions
  const pal = PALETTES.find(p => p.id === palette) ?? PALETTES[0];

  const impExpression = useMemo(() => {
    if (!stats.impPerc) return ['literal', '#1a1a1a'];
    return buildFillExpression('impressions', pal.stops, stats.impPerc, inverted);
  }, [stats.impPerc, pal.stops, inverted]);

  const popExpression = useMemo(() => {
    if (!stats.popPerc) return ['literal', '#1a1a1a'];
    return buildFillExpression('pop_total', PALETTES[0].stops, stats.popPerc, false); // always bleu for pop
  }, [stats.popPerc]);

  const ratioExpression = useMemo(() => {
    if (!stats.ratioPerc) return ['literal', '#1a1a1a'];
    return buildFillExpression('imp_pour_mille', RATIO_PALETTE.stops, stats.ratioPerc, false);
  }, [stats.ratioPerc]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#050505' }}>

      {/* Toolbar */}
      <DigitalToolbar
        campaigns={campaigns}
        selectedCampaign={campaignId}
        onCampaignChange={handleCampaignChange}
        scale={scale}
        onScaleChange={handleScaleChange}
        palette={palette}
        onPaletteChange={setPalette}
        inverted={inverted}
        onInvertedChange={setInverted}
        loading={geojsonLoading}
        zonesCount={geojson?.features.length ?? 0}
        totalImpressions={stats.totalImp}
      />

      {/* 3 maps */}
      <div style={{ flex: 1, display: 'flex', gap: 1, background: '#1a1a1a', minHeight: 0 }}>
        {/* Map 1: Impressions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050505' }}>
          <div style={{ padding: '6px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#a0a0a0', borderBottom: '0.5px solid #1a1a1a' }}>
            Impressions
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <SyncMap
              id="imp"
              geojson={geojson}
              fillExpression={impExpression}
              lineColor="rgba(78,205,196,0.25)"
              onMove={handleMove('imp')}
              syncTarget={syncSource !== 'imp' ? syncState : null}
            />
          </div>
          {stats.impPerc && (
            <MapLegend
              title="Impressions"
              stops={inverted ? [...pal.stops].reverse() : pal.stops}
              minLabel="0"
              midLabel={stats.impPerc.p50.toLocaleString('fr-FR')}
              maxLabel={stats.impPerc.max.toLocaleString('fr-FR')}
            />
          )}
        </div>

        {/* Map 2: Population */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050505' }}>
          <div style={{ padding: '6px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#a0a0a0', borderBottom: '0.5px solid #1a1a1a' }}>
            Population
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <SyncMap
              id="pop"
              geojson={geojson}
              fillExpression={popExpression}
              lineColor="rgba(66,146,198,0.25)"
              onMove={handleMove('pop')}
              syncTarget={syncSource !== 'pop' ? syncState : null}
            />
          </div>
          {stats.popPerc && (
            <MapLegend
              title="Population"
              stops={PALETTES[0].stops}
              minLabel="0"
              midLabel={stats.popPerc.p50.toLocaleString('fr-FR')}
              maxLabel={stats.popPerc.max.toLocaleString('fr-FR')}
            />
          )}
        </div>

        {/* Map 3: Ratio */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050505' }}>
          <div style={{ padding: '6px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#a0a0a0', borderBottom: '0.5px solid #1a1a1a' }}>
            Ratio imp./1000 hab
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <SyncMap
              id="ratio"
              geojson={geojson}
              fillExpression={ratioExpression}
              lineColor="rgba(180,180,180,0.2)"
              onMove={handleMove('ratio')}
              syncTarget={syncSource !== 'ratio' ? syncState : null}
            />
          </div>
          {stats.ratioPerc && (
            <MapLegend
              title="Ratio (imp./1000 hab)"
              stops={RATIO_PALETTE.stops}
              minLabel="sous-servi"
              midLabel="médiane"
              maxLabel="sur-servi"
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/map/analyse/digital/page.tsx
git commit -m "feat(digital-triple): main triple map page"
```

---

### Task 7: Add navigation link in AppSidebar

**Files:**
- Modify: `components/AppSidebar.tsx`

- [ ] **Step 1: Find the nav section and add link**

Search for existing nav items pattern (look for `/map` or `/clusters` links). Add:

```typescript
{ href: '/map/analyse/digital', label: 'Digital', icon: BarChart3 },
```

Use the same pattern as existing sidebar items. Import `BarChart3` from `lucide-react` if not already imported.

- [ ] **Step 2: Commit**

```bash
git add components/AppSidebar.tsx
git commit -m "feat(digital-triple): add sidebar nav link"
```

---

### Task 8: TypeScript check + manual verification

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```

Expected: no new errors (only pre-existing iris-crawler/iris-values ones).

- [ ] **Step 2: Manual test**

1. `npm run dev`
2. Navigate to `/map/analyse/digital`
3. Select campaign "Q1" from dropdown
4. Verify 3 maps load with same GeoJSON
5. Pan/zoom one map → others follow
6. Toggle scale: CP → Dept → Region
7. Change palette → impressions map updates
8. Hover on a zone → popup on that map

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(digital-triple): verification pass"
```

---

## Notes

- **No new API routes needed** — reuses existing `/api/digital/[campaignId]/map`
- **No new DB queries** — reuses `get_digital_campaign_map` RPC
- **1 fetch, 3 views** — the GeoJSON is fetched once and shared across all 3 maps via props
- **Population comes from `pop_total`** in the GeoJSON properties (already in RPC)
- **Ratio `imp_pour_mille`** is pre-computed in the RPC for CP scale, calculated client-side for dept/region
