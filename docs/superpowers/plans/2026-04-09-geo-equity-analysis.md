# Geo-Equity Bidding Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Geo-Equity Bidding" accordion section in the map Expert/Analyse tab that visualizes DSP campaign impression pressure vs. population targets, with a divergent choropleth layer on the map.

**Architecture:** SQL view disaggregates CP-level impressions to IRIS-level proportionally by population. An RPC function returns GeoJSON with dynamic population target field. A new API route serves the data bbox-filtered. The FilterPanel gets a new accordion section with campaign/population selectors, stats, and legend. Map layers use a red→white→blue divergent palette.

**Tech Stack:** PostgreSQL (view + RPC), Next.js API Route, React (FilterPanel accordion), MapLibre GL JS (fill + line layers), TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260409_geo_equity_view.sql` | Create | SQL view + RPC function |
| `app/api/map/equity-analysis/route.ts` | Create | API route: GeoJSON + stats |
| `types/campaign.ts` | Modify | Add `EquityAnalysisStats` type |
| `app/map/_components/FilterPanel.tsx` | Modify | New accordion section + props |
| `app/map/page.tsx` | Modify | Equity state + map layer sync |
| `app/copilote/_hooks/useMapInit.ts` | Modify | Add equity source + layers |

---

## Task 1: SQL View + RPC Function

**Files:**
- Create: `supabase/migrations/20260409_geo_equity_view.sql`

- [ ] **Step 1: Write the migration SQL file**

```sql
-- Geo-Equity: disaggregate DSP impressions from CP to IRIS level
-- proportionally by population, then compute equity_index

-- View: v_dsp_iris_equity
CREATE OR REPLACE VIEW v_dsp_iris_equity AS
WITH cp_population AS (
  SELECT 
    pc.code_postal,
    SUM(i.population) as pop_total_cp
  FROM postal_code_commune pc
  JOIN iris i ON i.code_commune = pc.code_commune
  GROUP BY pc.code_postal
),
impressions_par_iris AS (
  SELECT 
    d.campaign_id,
    i.code_iris,
    i.code_commune,
    i.nom_commune,
    i.code_dept,
    i.code_region,
    SUM(
      d.tracked_ads * (i.population::float / NULLIF(cp.pop_total_cp, 0))
    ) as impressions,
    MAX(i.population) as population,
    MAX(i.pop_15_29) as pop_15_29,
    MAX(i.pop_30_44) as pop_30_44,
    MAX(i.nb_csp_cadre) as nb_csp_cadre,
    MAX(i.nb_diplome_sup) as nb_diplome_sup,
    MAX(i.rev_median) as rev_median,
    MAX(i.taux_proprio) as taux_proprio,
    MAX(i.nb_menages) as nb_menages,
    MAX(i.geom) as geom
  FROM dsp_campaign_data d
  JOIN postal_code_commune pc ON pc.code_postal = d.postal_code
  JOIN iris i ON i.code_commune = pc.code_commune
  JOIN cp_population cp ON cp.code_postal = d.postal_code
  WHERE d.country = 'France'
    AND i.population > 0
  GROUP BY d.campaign_id, i.code_iris, i.code_commune, i.nom_commune, i.code_dept, i.code_region
)
SELECT 
  *,
  CASE 
    WHEN population > 0 
    THEN ROUND((impressions / population * 1000)::numeric, 2)
    ELSE NULL 
  END as equity_index
FROM impressions_par_iris;


-- RPC: get_equity_analysis
-- Returns GeoJSON-ready rows for a campaign, bbox-filtered, with dynamic population field
CREATE OR REPLACE FUNCTION get_equity_analysis(
  p_campaign_id UUID,
  p_population_field TEXT DEFAULT 'population',
  p_bbox float8[] DEFAULT NULL
)
RETURNS TABLE (
  code_iris TEXT,
  nom_commune TEXT,
  code_dept TEXT,
  impressions FLOAT,
  population_cible FLOAT,
  equity_index FLOAT,
  geom GEOMETRY
) AS $$
DECLARE
  allowed_fields TEXT[] := ARRAY['population','pop_15_29','pop_30_44','nb_csp_cadre','nb_diplome_sup','rev_median','taux_proprio','nb_menages'];
  safe_field TEXT;
BEGIN
  -- Whitelist validation
  IF p_population_field = ANY(allowed_fields) THEN
    safe_field := p_population_field;
  ELSE
    safe_field := 'population';
  END IF;

  RETURN QUERY
  EXECUTE format('
    SELECT 
      v.code_iris,
      v.nom_commune,
      v.code_dept,
      v.impressions,
      v.%I::float as population_cible,
      CASE 
        WHEN v.%I > 0 
        THEN ROUND((v.impressions / v.%I * 1000)::numeric, 2)
        ELSE NULL 
      END as equity_index,
      v.geom
    FROM v_dsp_iris_equity v
    WHERE v.campaign_id = $1
      AND ($2 IS NULL OR v.geom && ST_MakeEnvelope($2[1], $2[2], $2[3], $2[4], 4326))
    LIMIT 5000
  ', safe_field, safe_field, safe_field)
  USING p_campaign_id, p_bbox;
END;
$$ LANGUAGE plpgsql;


-- RPC: get_equity_stats
-- Returns aggregate stats for a campaign + population field
CREATE OR REPLACE FUNCTION get_equity_stats(
  p_campaign_id UUID,
  p_population_field TEXT DEFAULT 'population'
)
RETURNS JSON AS $$
DECLARE
  allowed_fields TEXT[] := ARRAY['population','pop_15_29','pop_30_44','nb_csp_cadre','nb_diplome_sup','rev_median','taux_proprio','nb_menages'];
  safe_field TEXT;
  result JSON;
BEGIN
  IF p_population_field = ANY(allowed_fields) THEN
    safe_field := p_population_field;
  ELSE
    safe_field := 'population';
  END IF;

  EXECUTE format('
    SELECT json_build_object(
      ''total_impressions'', ROUND(SUM(v.impressions)::numeric, 0),
      ''total_population'', SUM(v.%I),
      ''avg_equity'', ROUND(AVG(CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END)::numeric, 2),
      ''zones_sous_servies'', COUNT(*) FILTER (WHERE CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END < 0.5),
      ''zones_sur_servies'', COUNT(*) FILTER (WHERE CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END > 2.0),
      ''zones_equilibrees'', COUNT(*) FILTER (WHERE CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END BETWEEN 0.5 AND 2.0),
      ''total_zones'', COUNT(*)
    )
    FROM v_dsp_iris_equity v
    WHERE v.campaign_id = $1
  ', safe_field, safe_field, safe_field, safe_field, safe_field, safe_field, safe_field, safe_field)
  INTO result
  USING p_campaign_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Deploy via MCP Supabase**

Run the migration against the production database using the `mcp__claude_ai_Supabase__execute_sql` tool with project ID `vkkdbygwbrxyogqosten`.

- [ ] **Step 3: Validate with a test query**

```sql
-- Test the view exists and returns data
SELECT COUNT(*) FROM v_dsp_iris_equity LIMIT 1;

-- Test the RPC
SELECT code_iris, impressions, population_cible, equity_index
FROM get_equity_analysis(
  (SELECT id FROM dsp_campaigns LIMIT 1),
  'population',
  ARRAY[-5.5, 41.2, 9.8, 51.2]
)
LIMIT 5;

-- Test stats RPC
SELECT get_equity_stats(
  (SELECT id FROM dsp_campaigns LIMIT 1),
  'population'
);
```

- [ ] **Step 4: Save migration file locally**

Write the SQL to `supabase/migrations/20260409_geo_equity_view.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260409_geo_equity_view.sql
git commit -m "feat: add geo-equity SQL view and RPC functions for DSP impression disaggregation"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `types/campaign.ts`

- [ ] **Step 1: Add equity analysis types**

Add at the end of `types/campaign.ts`:

```typescript
/* ── Geo-Equity analysis types ──────────────── */

export interface EquityAnalysisStats {
  total_impressions: number;
  total_population: number;
  avg_equity: number;
  zones_sous_servies: number;
  zones_sur_servies: number;
  zones_equilibrees: number;
  total_zones: number;
}

export const POPULATION_TARGETS = [
  { value: 'population', label: 'Population totale' },
  { value: 'pop_15_29', label: 'Jeunes 15-29 ans' },
  { value: 'pop_30_44', label: 'Adultes 30-44 ans' },
  { value: 'nb_csp_cadre', label: 'CSP+ (cadres)' },
  { value: 'nb_diplome_sup', label: 'Diplômés supérieur' },
  { value: 'nb_menages', label: 'Nombre de ménages' },
  { value: 'rev_median', label: 'Revenus médians (€)' },
] as const;

export type PopulationField = typeof POPULATION_TARGETS[number]['value'];
```

- [ ] **Step 2: Commit**

```bash
git add types/campaign.ts
git commit -m "feat: add EquityAnalysisStats type and POPULATION_TARGETS constant"
```

---

## Task 3: API Route

**Files:**
- Create: `app/api/map/equity-analysis/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import type { EquityAnalysisStats } from '@/types/campaign';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = ['population', 'pop_15_29', 'pop_30_44', 'nb_csp_cadre', 'nb_diplome_sup', 'rev_median', 'taux_proprio', 'nb_menages'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id');
  const populationField = searchParams.get('population_field') || 'population';
  const bboxStr = searchParams.get('bbox');

  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  if (!ALLOWED_FIELDS.includes(populationField)) {
    return NextResponse.json({ error: `Invalid population_field. Allowed: ${ALLOWED_FIELDS.join(', ')}` }, { status: 400 });
  }

  let bbox: number[] | null = null;
  if (bboxStr) {
    const parts = bboxStr.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return NextResponse.json({ error: 'bbox must be xmin,ymin,xmax,ymax' }, { status: 400 });
    }
    bbox = parts;
  }

  try {
    const supabase = createAdminClient();

    // Fetch GeoJSON data and stats in parallel
    const [geoResult, statsResult] = await Promise.all([
      supabase.rpc('get_equity_analysis', {
        p_campaign_id: campaignId,
        p_population_field: populationField,
        p_bbox: bbox,
      }),
      supabase.rpc('get_equity_stats', {
        p_campaign_id: campaignId,
        p_population_field: populationField,
      }),
    ]);

    if (geoResult.error) {
      console.error('[equity-analysis] geo error:', geoResult.error);
      return NextResponse.json({ error: geoResult.error.message }, { status: 500 });
    }

    if (statsResult.error) {
      console.error('[equity-analysis] stats error:', statsResult.error);
      return NextResponse.json({ error: statsResult.error.message }, { status: 500 });
    }

    const rows = geoResult.data || [];
    const stats: EquityAnalysisStats = statsResult.data || {
      total_impressions: 0, total_population: 0, avg_equity: 0,
      zones_sous_servies: 0, zones_sur_servies: 0, zones_equilibrees: 0, total_zones: 0,
    };

    // Build GeoJSON FeatureCollection
    const features = rows
      .filter((r: { geom: unknown }) => r.geom)
      .map((r: { code_iris: string; nom_commune: string; code_dept: string; impressions: number; population_cible: number; equity_index: number; geom: unknown }) => ({
        type: 'Feature' as const,
        properties: {
          code_iris: r.code_iris,
          nom_commune: r.nom_commune,
          code_dept: r.code_dept,
          impressions: Math.round(r.impressions ?? 0),
          population_cible: Math.round(r.population_cible ?? 0),
          equity_index: r.equity_index ?? 0,
        },
        geometry: r.geom,
      }));

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      stats,
      truncated: features.length >= 5000,
    }, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    });
  } catch (err) {
    console.error('[equity-analysis] unexpected error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/map/equity-analysis/route.ts
git commit -m "feat: add GET /api/map/equity-analysis route for geo-equity GeoJSON + stats"
```

---

## Task 4: Map Layers Setup (useMapInit)

**Files:**
- Modify: `app/copilote/_hooks/useMapInit.ts`

- [ ] **Step 1: Add equity source and layers in the `map.on('load')` callback**

After the radio coverage layers (around line 463), add the equity layers. Find the section after radio coverage setup and before the click handlers section.

Insert after the `radio-coverage-line` layer:

```typescript
// ── Geo-Equity choropleth ─────────────────────────────────────────
map.addSource('equity-analysis', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
});

map.addLayer({
  id: 'equity-fill',
  type: 'fill',
  source: 'equity-analysis',
  paint: {
    'fill-color': [
      'interpolate', ['linear'], ['coalesce', ['get', 'equity_index'], 0],
      0,   '#b2182b',
      0.5, '#ef8a62',
      1.0, '#f7f7f7',
      2.0, '#67a9cf',
      4.0, '#2166ac',
    ],
    'fill-opacity': 0.75,
  },
  layout: { visibility: 'none' },
});

map.addLayer({
  id: 'equity-line',
  type: 'line',
  source: 'equity-analysis',
  paint: {
    'line-color': '#333333',
    'line-width': 0.5,
  },
  layout: { visibility: 'none' },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/copilote/_hooks/useMapInit.ts
git commit -m "feat: add equity-analysis source and layers to map initialization"
```

---

## Task 5: Map Page State + Layer Sync

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1: Add equity state variables**

After the radio state variables (around line 91), add:

```typescript
// Geo-Equity analysis
const [equityVisible, setEquityVisible] = useState(false);
const [equityGeoJSON, setEquityGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
const [equityStats, setEquityStats] = useState<EquityAnalysisStats | null>(null);
const [equityLoading, setEquityLoading] = useState(false);
const [equityCampaignId, setEquityCampaignId] = useState<string | null>(null);
const [equityPopField, setEquityPopField] = useState<string>('population');
```

Add the import at the top:
```typescript
import type { EquityAnalysisStats } from '@/types/campaign';
```

- [ ] **Step 2: Add layer visibility sync useEffect**

After the existing layer sync effects (e.g., after the TMJA sync), add:

```typescript
// ── Sync equity layer visibility + data ──────────────────────────
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;
  const vis = equityVisible && equityGeoJSON ? 'visible' : 'none';
  if (map.getLayer('equity-fill')) map.setLayoutProperty('equity-fill', 'visibility', vis);
  if (map.getLayer('equity-line')) map.setLayoutProperty('equity-line', 'visibility', vis);
  if (equityGeoJSON) {
    const src = map.getSource('equity-analysis') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(equityGeoJSON);
  }
}, [equityVisible, equityGeoJSON, mapReady, mapRef]);
```

- [ ] **Step 3: Add equity hover interaction**

After the equity sync effect, add a hover popup effect:

```typescript
// ── Equity hover popup ───────────────────────────────────────────
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;
  if (!equityVisible) return;

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '260px' });

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  };
  const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    if (!e.features?.length) return;
    const f = e.features[0];
    const p = f.properties;
    const eq = p.equity_index ?? 0;
    const tag = eq < 0.5 ? '<span style="color:#ef8a62">sous-servi</span>'
              : eq > 2.0 ? '<span style="color:#67a9cf">sur-servi</span>'
              : '<span style="color:#999">équilibré</span>';
    popup.setLngLat(e.lngLat).setHTML(`
      <div style="font-family:Inter,sans-serif;font-size:11px;color:#f0f0f0;background:#0a0a0a;padding:8px 10px;border-radius:6px;border:0.5px solid #262626">
        <div style="font-weight:500;margin-bottom:4px">${esc(p.code_iris)} — ${esc(p.nom_commune)}</div>
        <div style="color:#a0a0a0">Impressions: <span style="color:#f0f0f0;font-family:'JetBrains Mono',monospace">${Number(p.impressions).toLocaleString('fr-FR')}</span></div>
        <div style="color:#a0a0a0">Pop. cible: <span style="color:#f0f0f0;font-family:'JetBrains Mono',monospace">${Number(p.population_cible).toLocaleString('fr-FR')}</span></div>
        <div style="color:#a0a0a0">Equity: <span style="font-family:'JetBrains Mono',monospace">${eq.toFixed(2)}</span> ${tag}</div>
      </div>
    `).addTo(map);
  };

  map.on('mouseenter', 'equity-fill', onEnter);
  map.on('mouseleave', 'equity-fill', onLeave);
  map.on('mousemove', 'equity-fill', onMove);

  return () => {
    map.off('mouseenter', 'equity-fill', onEnter);
    map.off('mouseleave', 'equity-fill', onLeave);
    map.off('mousemove', 'equity-fill', onMove);
    popup.remove();
  };
}, [equityVisible, mapReady, mapRef]);
```

- [ ] **Step 4: Pass equity props to FilterPanel**

In the `<FilterPanel>` JSX, add the equity props:

```typescript
// Geo-Equity
equityVisible={equityVisible}
equityStats={equityStats}
equityLoading={equityLoading}
equityCampaignId={equityCampaignId}
equityPopField={equityPopField}
onEquityAnalyse={async (campaignId: string, popField: string) => {
  setEquityCampaignId(campaignId);
  setEquityPopField(popField);
  setEquityLoading(true);
  try {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    const res = await fetch(`/api/map/equity-analysis?campaign_id=${campaignId}&population_field=${popField}&bbox=${bbox}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    setEquityGeoJSON(data);
    setEquityStats(data.stats);
    setEquityVisible(true);
  } catch (err) {
    console.error('[equity] fetch error:', err);
  } finally {
    setEquityLoading(false);
  }
}}
onEquityClear={() => {
  setEquityVisible(false);
  setEquityGeoJSON(null);
  setEquityStats(null);
  setEquityCampaignId(null);
}}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add app/map/page.tsx
git commit -m "feat: add equity analysis state management and map layer sync"
```

---

## Task 6: FilterPanel Accordion Section

**Files:**
- Modify: `app/map/_components/FilterPanel.tsx`

- [ ] **Step 1: Add equity props to FilterPanelProps interface**

After the radio props block (around line 352), add:

```typescript
// Geo-Equity
equityVisible?: boolean;
equityStats?: EquityAnalysisStats | null;
equityLoading?: boolean;
equityCampaignId?: string | null;
equityPopField?: string;
onEquityAnalyse?: (campaignId: string, popField: string) => void;
onEquityClear?: () => void;
```

Add the imports at the top of the file:

```typescript
import type { CampaignListItem, EquityAnalysisStats } from '@/types/campaign';
import { POPULATION_TARGETS } from '@/types/campaign';
```

- [ ] **Step 2: Add equity state and campaign fetching inside the component**

After the `analyseOpen` state (around line 680), update the initial state to include 'equity':

Change the `analyseOpen` initial state from:
```typescript
const [analyseOpen, setAnalyseOpen] = useState<Record<string, boolean>>({
  spatiale: false, clustering: false, iris: false, carreaux: false, couverture: false, scoring: false,
});
```
to:
```typescript
const [analyseOpen, setAnalyseOpen] = useState<Record<string, boolean>>({
  spatiale: false, clustering: false, iris: false, carreaux: false, couverture: false, scoring: false, equity: false,
});
```

Then add campaign list state and fetcher right after:

```typescript
// Geo-Equity campaigns list
const [equityCampaigns, setEquityCampaigns] = useState<CampaignListItem[]>([]);
const [equitySelectedCampaign, setEquitySelectedCampaign] = useState<string>('');
const [equitySelectedPop, setEquitySelectedPop] = useState<string>('population');

useEffect(() => {
  if (!analyseOpen.equity) return;
  if (equityCampaigns.length > 0) return; // already fetched
  fetch('/api/admin/campaigns')
    .then(r => r.ok ? r.json() : [])
    .then((data: CampaignListItem[]) => setEquityCampaigns(data))
    .catch(() => {});
}, [analyseOpen.equity, equityCampaigns.length]);
```

- [ ] **Step 3: Add the accordion JSX**

Before the closing `</div>` of the analyse tab (right before line 3055 `</div>` that closes `{activeExpertTab === 'analyse' && (`), and after the scoring accordion section (after line 3053 `)}` that closes the scoring section), insert:

```tsx
{/* ── Accordéon : GEO-EQUITY BIDDING ────────────────────────── */}
<button
  onClick={() => toggleAnalyse('equity')}
  style={{
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', background: '#111111',
    border: 'none', borderTop: '1px solid #1a1a1a', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
  }}
>
  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ecdc4', flexShrink: 0 }} />
  <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: '#f0f0f0', flex: 1, textAlign: 'left' }}>
    Geo-Equity Bidding {equityVisible && <span style={{ color: C.green }}>●</span>}
  </span>
  <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.equity ? '▲' : '▼'}</span>
</button>
{analyseOpen.equity && (
<div style={{ padding: '16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
  {/* Campaign selector */}
  <div>
    <div style={labelStyle}>Campagne DSP</div>
    <select
      value={equitySelectedCampaign}
      onChange={e => setEquitySelectedCampaign(e.target.value)}
      style={{ ...inputStyle, cursor: 'pointer' }}
    >
      <option value="">Sélectionner une campagne…</option>
      {equityCampaigns.map(c => (
        <option key={c.id} value={c.id}>
          {c.name} — {c.total_tracked_ads?.toLocaleString('fr-FR')} imp.
          {c.date_start && c.date_end ? ` (${c.date_start.slice(0, 10)} → ${c.date_end.slice(0, 10)})` : ''}
        </option>
      ))}
    </select>
  </div>

  {/* Population target selector */}
  <div>
    <div style={labelStyle}>Population cible</div>
    <select
      value={equitySelectedPop}
      onChange={e => setEquitySelectedPop(e.target.value)}
      style={{ ...inputStyle, cursor: 'pointer' }}
    >
      {POPULATION_TARGETS.map(t => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  </div>

  {/* Launch button */}
  <button
    onClick={() => onEquityAnalyse?.(equitySelectedCampaign, equitySelectedPop)}
    disabled={!equitySelectedCampaign || equityLoading}
    style={primaryBtn('#4ecdc4', !equitySelectedCampaign || equityLoading)}
  >
    {equityLoading ? 'Analyse en cours…' : 'Lancer l\'analyse'}
  </button>

  {/* Clear button (if analysis active) */}
  {equityVisible && (
    <button
      onClick={() => {
        onEquityClear?.();
        setEquitySelectedCampaign('');
      }}
      style={{
        fontFamily: fInter, fontSize: 11, padding: '6px 10px',
        background: 'none', border: `0.5px solid ${C.border}`, borderRadius: 4,
        color: C.textDim, cursor: 'pointer', transition: 'all 0.2s',
      }}
    >
      Effacer l&apos;analyse
    </button>
  )}

  {/* Stats results */}
  {equityStats && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ height: 1, background: C.border }} />

      <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textSec }}>Résultats</div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: `0.5px solid ${C.border}` }}>
          <div style={{ fontFamily: fMono, fontSize: 13, color: C.text }}>{Number(equityStats.total_impressions).toLocaleString('fr-FR')}</div>
          <div style={{ fontFamily: fInter, fontSize: 10, color: C.textDim }}>Impressions</div>
        </div>
        <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: `0.5px solid ${C.border}` }}>
          <div style={{ fontFamily: fMono, fontSize: 13, color: C.text }}>{Number(equityStats.total_population).toLocaleString('fr-FR')}</div>
          <div style={{ fontFamily: fInter, fontSize: 10, color: C.textDim }}>Pop. cible</div>
        </div>
      </div>

      {/* Equity score */}
      <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: `0.5px solid ${C.border}`, textAlign: 'center' }}>
        <div style={{ fontFamily: fMono, fontSize: 16, color: '#4ecdc4' }}>{equityStats.avg_equity}</div>
        <div style={{ fontFamily: fInter, fontSize: 10, color: C.textDim }}>Index moyen (imp. / 1000 hab.)</div>
      </div>

      {/* Zone breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: fInter }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef8a62', flexShrink: 0 }} />
          <span style={{ color: C.textSec }}>Sous-servies (opportunités)</span>
          <span style={{ marginLeft: 'auto', fontFamily: fMono, color: C.text }}>{equityStats.zones_sous_servies.toLocaleString('fr-FR')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: fInter }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#e0e0e0', flexShrink: 0 }} />
          <span style={{ color: C.textSec }}>Équilibrées</span>
          <span style={{ marginLeft: 'auto', fontFamily: fMono, color: C.text }}>{equityStats.zones_equilibrees.toLocaleString('fr-FR')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: fInter }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#67a9cf', flexShrink: 0 }} />
          <span style={{ color: C.textSec }}>Sur-servies (gaspillage)</span>
          <span style={{ marginLeft: 'auto', fontFamily: fMono, color: C.text }}>{equityStats.zones_sur_servies.toLocaleString('fr-FR')}</span>
        </div>
      </div>

      {/* Legend gradient */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontFamily: fInter, fontSize: 10, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>Légende</div>
        <div style={{
          height: 12, borderRadius: 3,
          background: 'linear-gradient(to right, #b2182b, #ef8a62, #f7f7f7, #67a9cf, #2166ac)',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
          <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>Sous-servi (0)</span>
          <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>Équilibré (1)</span>
          <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>Sur-servi (4+)</span>
        </div>
      </div>

      <div style={{ fontFamily: fInter, fontSize: 9, color: C.textDim, fontStyle: 'italic' }}>
        {equityStats.total_zones.toLocaleString('fr-FR')} zones IRIS analysées
      </div>
    </div>
  )}
</div>
)}
```

- [ ] **Step 4: Destructure the new equity props**

In the component function, destructure the new props from the props object. Find where props are destructured and add:

```typescript
equityVisible, equityStats, equityLoading, equityCampaignId, equityPopField,
onEquityAnalyse, onEquityClear,
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add app/map/_components/FilterPanel.tsx
git commit -m "feat: add Geo-Equity Bidding accordion section in analyse tab"
```

---

## Task 7: Viewport Refresh on Map Move

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1: Add moveend listener for equity refresh**

After the equity sync effect, add a debounced map move handler that reloads equity data for the new viewport:

```typescript
// ── Refresh equity data on map move ──────────────────────────────
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady || !equityVisible || !equityCampaignId) return;

  let timer: ReturnType<typeof setTimeout>;
  const onMoveEnd = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const bounds = map.getBounds();
      const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
      try {
        const res = await fetch(`/api/map/equity-analysis?campaign_id=${equityCampaignId}&population_field=${equityPopField}&bbox=${bbox}`);
        if (!res.ok) return;
        const data = await res.json();
        setEquityGeoJSON(data);
        // Stats stay from initial full analysis
      } catch { /* ignore */ }
    }, 500);
  };

  map.on('moveend', onMoveEnd);
  return () => {
    map.off('moveend', onMoveEnd);
    clearTimeout(timer);
  };
}, [equityVisible, equityCampaignId, equityPopField, mapReady, mapRef]);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/map/page.tsx
git commit -m "feat: add viewport-based equity data refresh on map pan/zoom"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] Phase 1: SQL view `v_dsp_iris_equity` + RPC → Task 1
   - [x] Phase 2: API route `/api/map/equity-analysis` → Task 3
   - [x] Phase 3: Accordion UI with selectors + stats → Task 6
   - [x] Phase 4: Map layer with divergent palette → Task 4
   - [x] Phase 5: Legend + stats panel → Task 6 (integrated)
   - [x] Hover/click interaction → Task 5 (hover popup)
   - [x] Viewport-only loading → Task 7
   - [x] Types → Task 2

2. **Placeholder scan:** No TBD/TODO/placeholders found.

3. **Type consistency:** `EquityAnalysisStats` used consistently in types, API route, page state, and FilterPanel props. `POPULATION_TARGETS` constant shared between FilterPanel and types. `CampaignListItem` reused from existing type for campaign dropdown.

4. **Constraints verified:**
   - [x] LIMIT 5000 in RPC
   - [x] bbox-only loading (no France-wide)
   - [x] Design system: #111111 sections, teal dot, Inter/JetBrains Mono, sentence case
   - [x] No violet colors
   - [x] Existing accordion pattern followed exactly
   - [x] `createAdminClient()` in API route
   - [x] No modification to protected files
   - [x] Atomic commits per task
