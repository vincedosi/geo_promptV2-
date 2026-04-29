'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { SyncMap } from './_components/SyncMap';
import { MapLegend } from './_components/MapLegend';
import { RailroadPipeline, type GeographySet, type CustomZoneOption } from './_components/RailroadPipeline';
import { MeteoGeoPanel } from './_components/MeteoGeoPanel';
import { useDigitalData } from './_lib/use-digital-data';
import { PALETTES, RATIO_PALETTE, computePercentiles, buildFillExpression } from './_lib/palettes';
import { AnalysisPanelSwitch as AnalysisPanel } from '@/components/digital/AnalysisPanelSwitch';
import { WelcomeState } from './_components/WelcomeState';
import { CampaignContextBar } from './_components/CampaignContextBar';
import { CustomBiddingBar } from './_components/CustomBiddingBar';
import { KpiCardsDsp } from './_components/KpiCardsDsp';
import { KpiSelector } from './_components/KpiSelector';
import { adminFetch } from '@/lib/admin-fetch';
import { useSession } from '@/lib/auth-client';
import { useCustomGeoLayer } from '@/lib/custom-geo/useCustomGeoLayer';
import type { ContributedGeometry } from '@/types/custom-geo';
import type { MeteoParams, MeteoScale } from '@/lib/meteo/types';
import { METEO_LABEL } from '@/lib/meteo/types';
import { buildColorExpression as buildMeteoColorExpression, METEO_PALETTES } from '@/lib/meteo/palettes';

const fInter = "'Inter', sans-serif";

const POP_LABELS: Record<string, string> = {
  population: 'totale', pop_0_14: '0-14 ans', pop_15_29: '15-29 ans',
  pop_30_44: '30-44 ans', pop_45_59: '45-59 ans', pop_60_74: '60-74 ans',
  pop_75_plus: '75+ ans', nb_menages: 'menages', nb_csp_cadre: 'CSP+ cadres',
  nb_csp_employe: 'employes', nb_csp_ouvrier: 'ouvriers', nb_diplome_sup: 'diplome sup.',
  rev_median: 'revenu median', taux_chomage: '% chomage', taux_pauvrete: '% pauvrete',
};

const POP_FIELDS = Object.entries(POP_LABELS).map(([value, label]) => ({ value, label: label.charAt(0).toUpperCase() + label.slice(1) }));

type LayoutMode = 'equal' | 'focus-imp' | 'focus-pop' | 'focus-ratio';

function PalettePicker({ palettes, selected, onChange }: {
  palettes: { id: string; stops: string[] }[];
  selected: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {palettes.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)} style={{
          width: 18, height: 10, borderRadius: 2, cursor: 'pointer', padding: 0,
          background: `linear-gradient(to right, ${p.stops.join(', ')})`,
          border: `1.5px solid ${selected === p.id ? 'var(--text-primary)' : 'transparent'}`,
          transition: 'border 0.1s',
        }} />
      ))}
    </div>
  );
}


/** A single map panel with title bar, palette picker, map, legend */
function MapPanel({ title, titleAccent, palettes, palette, onPaletteChange, inverted, onInvertedChange, mapId, geojson, fillExpression, lineColor, onMove, syncTarget, zoomOffset, percentiles, legendStops, legendMin, legendMid, legendMax, hideAdminBoundaries, showFeatureHover, metricLabel }: {
  title: string;
  titleAccent?: string;
  palettes: { id: string; stops: string[] }[];
  palette: string;
  onPaletteChange: (id: string) => void;
  inverted: boolean;
  onInvertedChange: (v: boolean) => void;
  mapId: string;
  geojson: GeoJSON.FeatureCollection | null;
  fillExpression: unknown[];
  lineColor: string;
  onMove: (center: [number, number], zoom: number, bearing: number, pitch: number) => void;
  syncTarget: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null;
  zoomOffset?: number;
  percentiles: { p50: number; max: number } | null;
  legendStops: string[];
  legendMin: string;
  legendMid: string;
  legendMax: string;
  hideAdminBoundaries?: boolean;
  showFeatureHover?: boolean;
  metricLabel?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '6px 10px', fontFamily: fInter, borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {title}{titleAccent && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--brand-teal)', marginLeft: 4 }}>{titleAccent}</span>}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <PalettePicker palettes={palettes} selected={palette} onChange={onPaletteChange} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 9, color: 'var(--text-tertiary)' }}>
            <input type="checkbox" checked={inverted} onChange={e => onInvertedChange(e.target.checked)} style={{ accentColor: 'var(--brand-teal)', width: 9, height: 9 }} />
            inv
          </label>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <SyncMap
          id={mapId}
          geojson={geojson}
          fillExpression={fillExpression}
          lineColor={lineColor}
          onMove={onMove}
          syncTarget={syncTarget}
          zoomOffset={zoomOffset}
          hideAdminBoundaries={hideAdminBoundaries}
          showFeatureHover={showFeatureHover}
          metricLabel={metricLabel}
        />
      </div>
      {percentiles && <MapLegend title={title} stops={legendStops} minLabel={legendMin} midLabel={legendMid} maxLabel={legendMax} />}
    </div>
  );
}

export default function DigitalTripleMapPage() {
  const {
    campaigns, geojson, geojsonLoading, geographySummary,
    meteoData, meteoMeta, meteoLoading, meteoProgress, meteoError,
    fetchMap, fetchMeteo, clearMeteo,
  } = useDigitalData();

  const searchParams = useSearchParams();
  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  const [campaignId, setCampaignId] = useState('');
  const [scale, setScale] = useState('region');
  const [popField, setPopField] = useState('population');
  const [layout, setLayout] = useState<LayoutMode>('focus-ratio');
  const [analysisOpen, setAnalysisOpen] = useState(false);
  // KPI sélectionné — state local. Le KpiSelector et le toggle legacy
  // CampaignContextBar appellent setMetric directement (controlled).
  const [metric, setMetric] = useState<string>('impressions');
  const [geographySets, setGeographySets] = useState<GeographySet[]>([]);
  const [geographySetId, setGeographySetId] = useState<string | null>(null);
  const [customZones, setCustomZones] = useState<CustomZoneOption[]>([]);
  const [customZoneId, setCustomZoneId] = useState<string | null>(null);
  const [pendingCustomZoneId, setPendingCustomZoneId] = useState<string | null>(null);
  // Meteo overlay state : la 3eme carte reutilise les memes polygones que les
  // autres mais les colore par la valeur meteo lue dans meteoData[code].
  const [meteoOpen, setMeteoOpen] = useState(false);
  const [meteoParams, setMeteoParams] = useState<MeteoParams | null>(null);
  const isMeteoActive = meteoData !== null || meteoOpen;

  // Fetch geography sets on mount
  useEffect(() => {
    adminFetch('/api/geographies')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && Array.isArray(data.sets)) setGeographySets(data.sets);
      })
      .catch(() => {});
  }, []);

  // Fetch custom zones du workspace dès qu'on a l'orgId
  useEffect(() => {
    if (!orgId) return;
    adminFetch(`/api/custom-geo/list?org_id=${orgId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { zones?: CustomZoneOption[] } | null) => {
        if (data && Array.isArray(data.zones)) setCustomZones(data.zones);
      })
      .catch(() => {});
  }, [orgId]);

  // Query param ?customZone=<id> : présélectionne la zone custom + bascule scale
  // Uniquement si une campagne est déjà sélectionnée. Sinon, mémorise pour plus tard.
  useEffect(() => {
    const queryZoneId = searchParams.get('customZone');
    if (!queryZoneId) return;
    if (!campaignId) {
      setPendingCustomZoneId(queryZoneId);
      return;
    }
    // Vérifie que la zone existe encore (peut avoir été supprimée)
    if (customZones.length > 0 && !customZones.some(z => z.id === queryZoneId)) {
      console.warn('[digital] customZone query param points to missing zone', queryZoneId);
      return;
    }
    setScale('custom_zone');
    setCustomZoneId(queryZoneId);
    if (customZones.length > 0) {
      fetchMap(campaignId, 'custom_zone', popField, selectedMedia, metric, geographySetId, queryZoneId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, campaignId, customZones]);

  // Escape to close analysis
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setAnalysisOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const [mediaList, setMediaList] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);

  // Fetch media list when campaign changes
  useEffect(() => {
    if (!campaignId) { setMediaList([]); setSelectedMedia([]); return; }
    adminFetch(`/api/digital/${campaignId}/media`)
      .then(r => r.ok ? r.json() : [])
      .then((data: string[]) => { setMediaList(data); setSelectedMedia([]); })
      .catch(() => {});
  }, [campaignId]);

  const [impPalette, setImpPalette] = useState('teal');
  const [impInverted, setImpInverted] = useState(false);
  const [popPalette, setPopPalette] = useState('bleu');
  const [popInverted, setPopInverted] = useState(false);
  const [ratioPalette, setRatioPalette] = useState('ratio');
  const [ratioInverted, setRatioInverted] = useState(false);

  const [syncState, setSyncState] = useState<{
    center: [number, number]; zoom: number; bearing: number; pitch: number;
  } | null>(null);
  const [syncSource, setSyncSource] = useState<string | null>(null);

  const handleMove = useCallback((source: string) => (center: [number, number], zoom: number, bearing: number, pitch: number) => {
    setSyncSource(source);
    setSyncState({ center, zoom, bearing, pitch });
  }, []);

  const handleCampaignChange = useCallback((id: string) => {
    setCampaignId(id);
    if (id) fetchMap(id, scale, popField, selectedMedia, metric, geographySetId, customZoneId);
  }, [scale, popField, selectedMedia, metric, geographySetId, customZoneId, fetchMap]);

  const handleScaleChange = useCallback((s: string) => {
    setScale(s);
    let nextSetId = geographySetId;
    let nextCustomZoneId = customZoneId;
    if (s === 'zones' && !nextSetId && geographySets.length > 0) {
      nextSetId = geographySets[0].id;
      setGeographySetId(nextSetId);
    }
    if (s === 'custom_zone' && !nextCustomZoneId && customZones.length > 0) {
      nextCustomZoneId = customZones[0].id;
      setCustomZoneId(nextCustomZoneId);
    }
    if (campaignId) fetchMap(campaignId, s, popField, selectedMedia, metric, nextSetId, nextCustomZoneId);
  }, [campaignId, popField, selectedMedia, metric, geographySetId, geographySets, customZoneId, customZones, fetchMap]);

  const handlePopFieldChange = useCallback((f: string) => {
    setPopField(f);
    if (campaignId) fetchMap(campaignId, scale, f, selectedMedia, metric, geographySetId, customZoneId);
  }, [campaignId, scale, selectedMedia, metric, geographySetId, customZoneId, fetchMap]);

  const handleMediaChange = useCallback((media: string[]) => {
    setSelectedMedia(media);
    if (campaignId) fetchMap(campaignId, scale, popField, media, metric, geographySetId, customZoneId);
  }, [campaignId, scale, popField, metric, geographySetId, customZoneId, fetchMap]);

  const handleGeographySetChange = useCallback((setId: string | null) => {
    setGeographySetId(setId);
    if (campaignId && scale === 'zones') fetchMap(campaignId, 'zones', popField, selectedMedia, metric, setId, customZoneId);
  }, [campaignId, scale, popField, selectedMedia, metric, customZoneId, fetchMap]);

  const handleCustomZoneChange = useCallback((zoneId: string | null) => {
    setCustomZoneId(zoneId);
    if (campaignId && scale === 'custom_zone') fetchMap(campaignId, 'custom_zone', popField, selectedMedia, metric, geographySetId, zoneId);
  }, [campaignId, scale, popField, selectedMedia, metric, geographySetId, fetchMap]);

  // Re-fetch quand le KPI sélectionné change (KpiSelector URL-bound). Les
  // autres handlers (scale/popField/media/zone) gèrent leur propre fetch ;
  // celui-ci comble le cas où seul `?metric=` change.
  useEffect(() => {
    if (!campaignId) return;
    fetchMap(campaignId, scale, popField, selectedMedia, metric, geographySetId, customZoneId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  // Meteo : toggle du panel ET du mode overlay.
  // Clic quand inactif → ouvre le panel. Clic quand actif → sort du mode meteo.
  const handleMeteoClick = useCallback(() => {
    if (isMeteoActive) {
      setMeteoOpen(false);
      setMeteoParams(null);
      clearMeteo();
    } else {
      setMeteoOpen(true);
    }
  }, [isMeteoActive, clearMeteo]);

  // Mapping page scale → MeteoScale. Les zones custom et France n'ont pas
  // de centroides dans ref_*, on fallback sur departement dans ce cas.
  const toMeteoScale = useCallback((s: string): MeteoScale => {
    if (s === 'region') return 'region';
    if (s === 'cp') return 'cp';
    return 'departement';
  }, []);

  const handleMeteoApply = useCallback((params: MeteoParams) => {
    setMeteoParams(params);
    void fetchMeteo(toMeteoScale(scale), params);
  }, [scale, fetchMeteo, toMeteoScale]);

  // Refetch meteo quand le scale change pendant que le mode meteo est actif
  useEffect(() => {
    if (isMeteoActive && meteoParams) {
      void fetchMeteo(toMeteoScale(scale), meteoParams);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  const handleMeteoClose = useCallback(() => {
    setMeteoOpen(false);
    setMeteoParams(null);
    clearMeteo();
  }, [clearMeteo]);

  // Refetch map when metric toggles
  useEffect(() => {
    if (campaignId) fetchMap(campaignId, scale, popField, selectedMedia, metric, geographySetId, customZoneId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  // Si l'utilisateur est en mode zones mais qu'aucun set n'était dispo au moment
  // du switch, auto-sélectionner et fetcher dès que les sets arrivent
  useEffect(() => {
    if (scale === 'zones' && !geographySetId && geographySets.length > 0 && campaignId) {
      const firstId = geographySets[0].id;
      setGeographySetId(firstId);
      fetchMap(campaignId, 'zones', popField, selectedMedia, metric, firstId, customZoneId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geographySets, scale]);

  // Idem pour custom zones : auto-select première zone disponible quand on bascule en mode custom_zone
  useEffect(() => {
    if (scale === 'custom_zone' && !customZoneId && customZones.length > 0 && campaignId) {
      const firstId = customZones[0].id;
      setCustomZoneId(firstId);
      fetchMap(campaignId, 'custom_zone', popField, selectedMedia, metric, geographySetId, firstId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customZones, scale]);

  // Pending zone (issue de ?customZone=<id> arrivé avant la sélection de campagne)
  useEffect(() => {
    if (!pendingCustomZoneId || !campaignId || customZones.length === 0) return;
    if (customZones.some(z => z.id === pendingCustomZoneId)) {
      setScale('custom_zone');
      setCustomZoneId(pendingCustomZoneId);
      fetchMap(campaignId, 'custom_zone', popField, selectedMedia, metric, geographySetId, pendingCustomZoneId);
    }
    setPendingCustomZoneId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCustomZoneId, campaignId, customZones]);

  const stats = useMemo(() => {
    if (!geojson) return { impPerc: null, popPerc: null, ratioPerc: null, totalImp: 0 };
    const impValues = geojson.features.map(f => Number(f.properties?.impressions) || 0);
    const popValues = geojson.features.map(f => Number(f.properties?.pop_value) || 0);
    const ratioValues = geojson.features.map(f => Number(f.properties?.ratio) || 0).filter(v => v > 0);
    return {
      impPerc: computePercentiles(impValues),
      popPerc: computePercentiles(popValues),
      ratioPerc: computePercentiles(ratioValues),
      totalImp: impValues.reduce((a, b) => a + b, 0),
    };
  }, [geojson]);

  const allPalettes = [...PALETTES, RATIO_PALETTE];
  const impPal = PALETTES.find(p => p.id === impPalette) ?? PALETTES[0];
  const popPal = allPalettes.find(p => p.id === popPalette) ?? PALETTES[1];
  const ratPal = allPalettes.find(p => p.id === ratioPalette) ?? RATIO_PALETTE;

  const impExpr = useMemo(() => stats.impPerc ? buildFillExpression('impressions', impPal.stops, stats.impPerc, impInverted) : ['literal', 'var(--border-subtle)'], [stats.impPerc, impPal.stops, impInverted]);
  const popExpr = useMemo(() => stats.popPerc ? buildFillExpression('pop_value', popPal.stops, stats.popPerc, popInverted) : ['literal', 'var(--border-subtle)'], [stats.popPerc, popPal.stops, popInverted]);
  const ratExpr = useMemo(() => stats.ratioPerc ? buildFillExpression('ratio', ratPal.stops, stats.ratioPerc, ratioInverted) : ['literal', 'var(--border-subtle)'], [stats.ratioPerc, ratPal.stops, ratioInverted]);

  // Determine which map is focused (1/2) and which two are stacked (1/4 each)
  const focusMap = layout === 'equal' ? null : layout.replace('focus-', '');

  // Modes "single-feature" : zones isochrones (geography_set) OU zones custom (galerie).
  // Dans les 2 cas, la carte affiche une géométrie sélectionnée au lieu d'une choroplèthe.
  const isZones = scale === 'zones' || scale === 'custom_zone';

  // ── Custom geo capture : zone digital active (scale admin uniquement) ────
  // Pour zones/custom_zone, la geom est deja capturable directement via les routes
  // de consommation existantes. Ici on branche uniquement scale admin (region/dept/cp).
  const digitalScaleForCapture: 'region' | 'departement' | 'cp' | null =
    scale === 'region' || scale === 'departement' || scale === 'cp' ? scale : null;
  const getDigitalZoneGeom = useCallback(async (): Promise<ContributedGeometry> => {
    if (!digitalScaleForCapture || !campaignId) return null;
    const codes = geojson?.features
      ?.map(f => String(f.properties?.code ?? ''))
      .filter(Boolean)
      .slice(0, 10000) ?? null;
    const res = await adminFetch('/api/custom-geo/source/digital', {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: campaignId,
        scale: digitalScaleForCapture,
        codes: codes && codes.length > 0 ? codes : null,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data?.geometry ?? null) as ContributedGeometry;
  }, [digitalScaleForCapture, campaignId, geojson]);

  useCustomGeoLayer({
    id: 'digital-active-zone',
    sourceType: 'digital_analysis',
    label: digitalScaleForCapture
      ? `Analyse ${digitalScaleForCapture} (${geojson?.features.length ?? 0} zones)`
      : 'Analyse digital',
    enabled: !!digitalScaleForCapture && !!campaignId && !!geojson && geojson.features.length > 0,
    getGeometry: getDigitalZoneGeom,
    metadata: {
      campaign_id: campaignId,
      scale: digitalScaleForCapture,
      metric,
      features_count: geojson?.features.length ?? 0,
    },
  });

  // ── Custom geo capture : meteo (wrap autour de get_admin_filter_geometry) ──
  // La meteo est agregee par zones admin existantes ; on envoie scale + codes
  // et on enrichit les metadata cote route API avec variable/stats/timestamp.
  const meteoScaleForCapture: 'region' | 'departement' | 'cp' | null =
    digitalScaleForCapture; // meme scale que la choroplèthe
  const getMeteoGeom = useCallback(async (): Promise<ContributedGeometry> => {
    if (!meteoData || !meteoMeta || !meteoScaleForCapture) return null;
    const codes = Object.keys(meteoData).filter(Boolean).slice(0, 10000);
    if (codes.length === 0) return null;
    const res = await adminFetch('/api/custom-geo/source/meteo', {
      method: 'POST',
      body: JSON.stringify({
        scale: meteoScaleForCapture,
        codes,
        variable: meteoMeta.variable,
        timestamp: meteoParams ? `${meteoParams.startDate}_${meteoParams.endDate}` : null,
        stats: meteoMeta.stats
          ? { min: meteoMeta.stats.min, max: meteoMeta.stats.max, mean: meteoMeta.stats.mean }
          : null,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data?.geometry ?? null) as ContributedGeometry;
  }, [meteoData, meteoMeta, meteoScaleForCapture, meteoParams]);

  useCustomGeoLayer({
    id: 'digital-meteo-grid',
    sourceType: 'meteo_grid',
    label: meteoMeta ? `Meteo ${meteoMeta.variable}` : 'Meteo',
    enabled: !!meteoData && !!meteoMeta && !!meteoScaleForCapture,
    getGeometry: getMeteoGeom,
    metadata: {
      variable: meteoMeta?.variable ?? null,
      scale: meteoScaleForCapture,
      zones_count: meteoData ? Object.keys(meteoData).length : 0,
    },
  });
  const metricLabelLong = metric === 'unique' ? 'Imp. uniques' : 'Impressions';

  // Expression de fill et stops pour la 3eme carte en mode meteo.
  // La 3eme carte reutilise `geojson` (memes polygones que les 2 autres) mais
  // chaque feature est enrichie avec meteo_value/meteo_unit/meteo_label depuis
  // meteoData via le code de la zone.
  const meteoIsReady = !!(meteoData && meteoMeta);
  const meteoFillExpr = useMemo(() => {
    if (!meteoIsReady) return ['literal', 'var(--border-subtle)'];
    return buildMeteoColorExpression(meteoMeta!.variable, meteoMeta!.stats, 'meteo_value');
  }, [meteoIsReady, meteoMeta]);
  const meteoLegendStops = meteoIsReady ? METEO_PALETTES[meteoMeta!.variable] : [];

  // GeoJSON enrichi meteo : memes features que `geojson`, +props meteo_value/unit/label
  const meteoEnrichedGeojson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!meteoIsReady || !geojson) return null;
    return {
      type: 'FeatureCollection',
      features: geojson.features.map((f) => {
        const props = f.properties ?? {};
        const code = String(props.code ?? props.id ?? '');
        const entry = meteoData![code];
        return {
          ...f,
          properties: {
            ...props,
            meteo_value: entry?.value ?? null,
            meteo_unit: entry?.unit ?? '',
            meteo_label: entry?.label ?? '',
          },
        };
      }),
    };
  }, [meteoIsReady, meteoData, geojson]);

  const makePanel = (key: string, isSmall: boolean) => {
    const zo = isSmall ? -0.7 : 0;
    if (key === 'imp') return (
      <MapPanel title={metricLabelLong} palettes={PALETTES} palette={impPalette} onPaletteChange={setImpPalette} inverted={impInverted} onInvertedChange={setImpInverted}
        mapId="imp" geojson={geojson} fillExpression={impExpr} lineColor="rgba(78,205,196,0.25)"
        onMove={handleMove('imp')} syncTarget={syncSource !== 'imp' ? syncState : null} zoomOffset={zo}
        percentiles={stats.impPerc} legendStops={impInverted ? [...impPal.stops].reverse() : impPal.stops}
        legendMin="0" legendMid={stats.impPerc?.p50.toLocaleString('fr-FR') ?? ''} legendMax={stats.impPerc?.max.toLocaleString('fr-FR') ?? ''}
        hideAdminBoundaries={isZones} showFeatureHover={isZones} metricLabel={metricLabelLong} />
    );
    if (key === 'pop') {
      // Swap meteo : la 3eme carte reutilise les memes polygones (meteoEnrichedGeojson)
      // colores par la valeur meteo lue dans meteoData[code].
      if (isMeteoActive && meteoIsReady && meteoEnrichedGeojson) {
        return (
          <MapPanel title="Meteo" titleAccent={METEO_LABEL[meteoMeta!.variable]}
            palettes={[]} palette="" onPaletteChange={() => {}} inverted={false} onInvertedChange={() => {}}
            mapId="pop" geojson={meteoEnrichedGeojson} fillExpression={meteoFillExpr} lineColor="rgba(78,205,196,0.25)"
            onMove={handleMove('pop')} syncTarget={syncSource !== 'pop' ? syncState : null} zoomOffset={zo}
            percentiles={{ p50: meteoMeta!.stats.mean, max: meteoMeta!.stats.max }}
            legendStops={[...meteoLegendStops]}
            legendMin={`${meteoMeta!.stats.min.toFixed(1)} ${meteoMeta!.unit}`}
            legendMid={`${meteoMeta!.stats.mean.toFixed(1)} ${meteoMeta!.unit}`}
            legendMax={`${meteoMeta!.stats.max.toFixed(1)} ${meteoMeta!.unit}`}
            hideAdminBoundaries={isZones} showFeatureHover={true} metricLabel={METEO_LABEL[meteoMeta!.variable]} />
        );
      }
      return (
        <MapPanel title="Population" titleAccent={POP_LABELS[popField] ?? popField} palettes={allPalettes} palette={popPalette} onPaletteChange={setPopPalette} inverted={popInverted} onInvertedChange={setPopInverted}
          mapId="pop" geojson={geojson} fillExpression={popExpr} lineColor="rgba(66,146,198,0.25)"
          onMove={handleMove('pop')} syncTarget={syncSource !== 'pop' ? syncState : null} zoomOffset={zo}
          percentiles={stats.popPerc} legendStops={popInverted ? [...popPal.stops].reverse() : popPal.stops}
          legendMin="0" legendMid={stats.popPerc?.p50.toLocaleString('fr-FR') ?? ''} legendMax={stats.popPerc?.max.toLocaleString('fr-FR') ?? ''}
          hideAdminBoundaries={isZones} showFeatureHover={isZones} metricLabel={metricLabelLong} />
      );
    }
    return (
      <MapPanel title="Ratio" titleAccent={`${metric === 'unique' ? 'imp. uniques' : 'imp.'} / ${POP_LABELS[popField] ?? popField}`} palettes={allPalettes} palette={ratioPalette} onPaletteChange={setRatioPalette} inverted={ratioInverted} onInvertedChange={setRatioInverted}
        mapId="ratio" geojson={geojson} fillExpression={ratExpr} lineColor="rgba(180,180,180,0.2)"
        onMove={handleMove('ratio')} syncTarget={syncSource !== 'ratio' ? syncState : null} zoomOffset={zo}
        percentiles={stats.ratioPerc} legendStops={ratioInverted ? [...ratPal.stops].reverse() : ratPal.stops}
        legendMin="sous-servi" legendMid="mediane" legendMax="sur-servi"
        hideAdminBoundaries={isZones} showFeatureHover={isZones} metricLabel={metricLabelLong} />
    );
  };

  const allKeys = ['imp', 'pop', 'ratio'];

  // Concentration for health badge
  const concentrationTop10 = useMemo(() => {
    if (!geojson) return 0;
    const values = geojson.features.map(f => Number(f.properties?.impressions) || 0).sort((a, b) => b - a);
    const total = values.reduce((s, v) => s + v, 0);
    if (total === 0) return 0;
    const top10 = values.slice(0, Math.max(1, Math.ceil(values.length * 0.1))).reduce((s, v) => s + v, 0);
    return top10 / total * 100;
  }, [geojson]);

  // Campaign name and frequency from list
  const selectedCampaign = campaigns.find(c => c.id === campaignId);
  const campaignName = selectedCampaign?.name ?? '';
  const campaignFrequency = (selectedCampaign && selectedCampaign.total_unique_impressions > 0)
    ? selectedCampaign.total_tracked_ads / selectedCampaign.total_unique_impressions
    : null;

  const hasCampaign = !!campaignId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary)' }}>
      {/* État 2 : Railroad + Context bar — only when campaign selected */}
      {hasCampaign && (
        <>
          {/* Back button + Railroad */}
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <button onClick={() => { setCampaignId(''); setAnalysisOpen(false); }} style={{
              padding: '0 14px', background: 'var(--bg-surface)', border: 'none', borderRight: '0.5px solid var(--border-subtle)',
              cursor: 'pointer', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, transition: 'color 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-teal)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >← Campagnes</button>
            <div style={{ flex: 1 }}>
              <RailroadPipeline
                campaigns={campaigns} popFields={POP_FIELDS} mediaList={mediaList}
                geographySets={geographySets} customZones={customZones}
                selectedCampaign={campaignId} selectedPopField={popField} selectedScale={scale}
                selectedMedia={selectedMedia} selectedLayout={layout}
                selectedGeographySetId={geographySetId}
                selectedCustomZoneId={customZoneId}
                isMeteoActive={isMeteoActive}
                onCampaignChange={handleCampaignChange} onPopFieldChange={handlePopFieldChange}
                onScaleChange={handleScaleChange} onMediaChange={handleMediaChange} onLayoutChange={(l: string) => setLayout(l as LayoutMode)}
                onGeographySetChange={handleGeographySetChange}
                onCustomZoneChange={handleCustomZoneChange}
                onMeteoClick={handleMeteoClick}
                zonesCount={geojson?.features.length ?? 0} totalImpressions={stats.totalImp} metric={metric} loading={geojsonLoading || meteoLoading}
              />
            </div>
          </div>

          <CampaignContextBar
            campaignName={campaignName}
            totalImpressions={stats.totalImp}
            zonesCount={geojson?.features.length ?? 0}
            concentrationTop10={concentrationTop10}
            metric={metric}
            onMetricChange={setMetric}
            onOpenAnalysis={() => setAnalysisOpen(true)}
            inZonePct={isZones ? geographySummary?.pct_in_zone ?? null : null}
            inZoneImpressions={isZones ? geographySummary?.in_zone_impressions ?? null : null}
          />

          {campaignId && (
            <CustomBiddingBar
              campaignId={campaignId}
              campaignName={campaignName}
              dspSource={selectedCampaign?.dsp_source ?? null}
            />
          )}

          {/* Sélecteur de KPI global — chantier A3.1.
              Drive la choroplèthe (RPC v2), la heatmap (RPC v2), le breakdown
              (RPC v2) et les cards via le state `metric` partagé. */}
          {campaignId && (
            <div style={{
              padding: '6px 12px', display: 'flex', justifyContent: 'flex-end',
              borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--bg-surface)',
            }}>
              <KpiSelector
                campaignId={campaignId}
                value={metric}
                onChange={setMetric}
                hideIfSingle
              />
            </div>
          )}

          {/* Cards KPI multi-source — chantier A3.
              Driven par dsp_metrics_registry. Affiche dynamiquement les KPIs
              réellement remplis pour la campagne (Adform legacy : tracked_ads/
              unique_impressions ; TTD : impressions/clicks/spend/leads/…). */}
          {campaignId && <KpiCardsDsp campaignId={campaignId} />}
        </>
      )}

      {/* Content area */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!hasCampaign ? (
          /* État 1 : Page d'accueil */
          <WelcomeState
            campaigns={campaigns}
            loading={!campaigns.length && geojsonLoading}
            onSelect={handleCampaignChange}
          />
        ) : (
          <>
            {/* Maps — hidden when analysis overlay is open */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', opacity: analysisOpen ? 0 : 1, pointerEvents: analysisOpen ? 'none' : 'auto', transition: 'opacity 0.3s ease' }}>
              {layout === 'equal' ? (
                <div style={{ flex: 1, display: 'flex', gap: 1, background: 'var(--border-subtle)', minHeight: 0 }}>
                  {allKeys.map(k => <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{makePanel(k, false)}</div>)}
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', gap: 1, background: 'var(--border-subtle)', minHeight: 0 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    {makePanel(focusMap!, false)}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
                    {allKeys.filter(k => k !== focusMap).map(k => (
                      <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        {makePanel(k, true)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Meteo overlay panel : visible quand l'utilisateur a active le mode meteo */}
            {meteoOpen && !analysisOpen && (
              <div style={{
                position: 'absolute', top: 16, left: 16, zIndex: 30,
                pointerEvents: 'auto',
              }}>
                <MeteoGeoPanel
                  onApply={handleMeteoApply}
                  onClose={handleMeteoClose}
                  initialParams={meteoParams}
                  loading={meteoLoading}
                  progress={meteoProgress}
                  error={meteoError}
                  stats={meteoMeta?.stats ?? null}
                />
              </div>
            )}

            {/* Analysis overlay — modale fullscreen avec entrée bouncy / exit direct */}
            <div style={{
              position: 'absolute', inset: 0, zIndex: 40, background: 'var(--bg-surface)',
              opacity: analysisOpen ? 1 : 0,
              transform: analysisOpen ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(16px)',
              transformOrigin: 'center',
              pointerEvents: analysisOpen ? 'auto' : 'none',
              willChange: 'transform, opacity',
              transition: analysisOpen
                ? 'opacity var(--duration-enter) var(--ease-spring), transform var(--duration-enter) var(--ease-spring)'
                : 'opacity var(--duration-exit) var(--ease-exit), transform var(--duration-exit) var(--ease-exit)',
              display: 'flex', flexDirection: 'column',
            }}>
              <AnalysisPanel
                campaignId={campaignId}
                scale={scale}
                popField={popField}
                selectedMedia={selectedMedia}
                metric={metric}
                frequency={campaignFrequency}
                open={analysisOpen}
                onToggle={() => setAnalysisOpen(false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
