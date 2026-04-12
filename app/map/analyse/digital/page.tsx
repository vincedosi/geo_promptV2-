'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { SyncMap } from './_components/SyncMap';
import { MapLegend } from './_components/MapLegend';
import { DigitalToolbar } from './_components/DigitalToolbar';
import { useDigitalData } from './_lib/use-digital-data';
import { PALETTES, RATIO_PALETTE, computePercentiles, buildFillExpression } from './_lib/palettes';
import { AnalysisPanel } from './_components/AnalysisPanel';
import { WelcomeState } from './_components/WelcomeState';
import { CampaignContextBar } from './_components/CampaignContextBar';

const fInter = "'Inter', sans-serif";

const POP_LABELS: Record<string, string> = {
  population: 'totale', pop_0_14: '0-14 ans', pop_15_29: '15-29 ans',
  pop_30_44: '30-44 ans', pop_45_59: '45-59 ans', pop_60_74: '60-74 ans',
  pop_75_plus: '75+ ans', nb_menages: 'menages', nb_csp_cadre: 'CSP+ cadres',
  nb_csp_employe: 'employes', nb_csp_ouvrier: 'ouvriers', nb_diplome_sup: 'diplome sup.',
  rev_median: 'revenu median', taux_chomage: '% chomage', taux_pauvrete: '% pauvrete',
};

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
          border: `1.5px solid ${selected === p.id ? '#f0f0f0' : 'transparent'}`,
          transition: 'border 0.1s',
        }} />
      ))}
    </div>
  );
}

function LayoutButtons({ layout, onChange }: { layout: LayoutMode; onChange: (l: LayoutMode) => void }) {
  const modes: { id: LayoutMode; label: string }[] = [
    { id: 'equal', label: '1/3 · 1/3 · 1/3' },
    { id: 'focus-imp', label: 'Imp. focus' },
    { id: 'focus-pop', label: 'Pop. focus' },
    { id: 'focus-ratio', label: 'Ratio focus' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {modes.map(m => (
        <button key={m.id} onClick={() => onChange(m.id)} style={{
          padding: '4px 8px', fontSize: 10, fontFamily: fInter, cursor: 'pointer',
          background: layout === m.id ? 'rgba(78,205,196,0.12)' : 'transparent',
          border: `0.5px solid ${layout === m.id ? '#4ecdc4' : '#1a1a1a'}`,
          borderRadius: 3, color: layout === m.id ? '#4ecdc4' : '#666666',
          transition: 'all 0.15s',
        }}>{m.label}</button>
      ))}
    </div>
  );
}

/** A single map panel with title bar, palette picker, map, legend */
function MapPanel({ title, titleAccent, palettes, palette, onPaletteChange, inverted, onInvertedChange, mapId, geojson, fillExpression, lineColor, onMove, syncTarget, zoomOffset, percentiles, legendStops, legendMin, legendMid, legendMax }: {
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
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#050505', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '6px 10px', fontFamily: fInter, borderBottom: '0.5px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#f0f0f0' }}>
          {title}{titleAccent && <span style={{ fontSize: 10, fontWeight: 400, color: '#4ecdc4', marginLeft: 4 }}>{titleAccent}</span>}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <PalettePicker palettes={palettes} selected={palette} onChange={onPaletteChange} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 9, color: '#666666' }}>
            <input type="checkbox" checked={inverted} onChange={e => onInvertedChange(e.target.checked)} style={{ accentColor: '#4ecdc4', width: 9, height: 9 }} />
            inv
          </label>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <SyncMap id={mapId} geojson={geojson} fillExpression={fillExpression} lineColor={lineColor} onMove={onMove} syncTarget={syncTarget} zoomOffset={zoomOffset} />
      </div>
      {percentiles && <MapLegend title={title} stops={legendStops} minLabel={legendMin} midLabel={legendMid} maxLabel={legendMax} />}
    </div>
  );
}

export default function DigitalTripleMapPage() {
  const { campaigns, geojson, geojsonLoading, fetchMap } = useDigitalData();

  const [campaignId, setCampaignId] = useState('');
  const [scale, setScale] = useState('cp');
  const [popField, setPopField] = useState('population');
  const [layout, setLayout] = useState<LayoutMode>('equal');
  const [analysisOpen, setAnalysisOpen] = useState(false);

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
    fetch(`/api/digital/${campaignId}/media`)
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
    if (id) fetchMap(id, scale, popField);
  }, [scale, popField, fetchMap]);

  const handleScaleChange = useCallback((s: string) => {
    setScale(s);
    if (campaignId) fetchMap(campaignId, s, popField, selectedMedia);
  }, [campaignId, popField, selectedMedia, fetchMap]);

  const handlePopFieldChange = useCallback((f: string) => {
    setPopField(f);
    if (campaignId) fetchMap(campaignId, scale, f, selectedMedia);
  }, [campaignId, scale, selectedMedia, fetchMap]);

  const handleMediaChange = useCallback((media: string[]) => {
    setSelectedMedia(media);
    if (campaignId) fetchMap(campaignId, scale, popField, media);
  }, [campaignId, scale, popField, fetchMap]);

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

  const impExpr = useMemo(() => stats.impPerc ? buildFillExpression('impressions', impPal.stops, stats.impPerc, impInverted) : ['literal', '#1a1a1a'], [stats.impPerc, impPal.stops, impInverted]);
  const popExpr = useMemo(() => stats.popPerc ? buildFillExpression('pop_value', popPal.stops, stats.popPerc, popInverted) : ['literal', '#1a1a1a'], [stats.popPerc, popPal.stops, popInverted]);
  const ratExpr = useMemo(() => stats.ratioPerc ? buildFillExpression('ratio', ratPal.stops, stats.ratioPerc, ratioInverted) : ['literal', '#1a1a1a'], [stats.ratioPerc, ratPal.stops, ratioInverted]);

  // Determine which map is focused (1/2) and which two are stacked (1/4 each)
  const focusMap = layout === 'equal' ? null : layout.replace('focus-', '');

  const makePanel = (key: string, isSmall: boolean) => {
    const zo = isSmall ? -0.7 : 0;
    if (key === 'imp') return (
      <MapPanel title="Impressions" palettes={PALETTES} palette={impPalette} onPaletteChange={setImpPalette} inverted={impInverted} onInvertedChange={setImpInverted}
        mapId="imp" geojson={geojson} fillExpression={impExpr} lineColor="rgba(78,205,196,0.25)"
        onMove={handleMove('imp')} syncTarget={syncSource !== 'imp' ? syncState : null} zoomOffset={zo}
        percentiles={stats.impPerc} legendStops={impInverted ? [...impPal.stops].reverse() : impPal.stops}
        legendMin="0" legendMid={stats.impPerc?.p50.toLocaleString('fr-FR') ?? ''} legendMax={stats.impPerc?.max.toLocaleString('fr-FR') ?? ''} />
    );
    if (key === 'pop') return (
      <MapPanel title="Population" titleAccent={POP_LABELS[popField] ?? popField} palettes={allPalettes} palette={popPalette} onPaletteChange={setPopPalette} inverted={popInverted} onInvertedChange={setPopInverted}
        mapId="pop" geojson={geojson} fillExpression={popExpr} lineColor="rgba(66,146,198,0.25)"
        onMove={handleMove('pop')} syncTarget={syncSource !== 'pop' ? syncState : null} zoomOffset={zo}
        percentiles={stats.popPerc} legendStops={popInverted ? [...popPal.stops].reverse() : popPal.stops}
        legendMin="0" legendMid={stats.popPerc?.p50.toLocaleString('fr-FR') ?? ''} legendMax={stats.popPerc?.max.toLocaleString('fr-FR') ?? ''} />
    );
    return (
      <MapPanel title="Ratio" titleAccent={`imp. / ${POP_LABELS[popField] ?? popField}`} palettes={allPalettes} palette={ratioPalette} onPaletteChange={setRatioPalette} inverted={ratioInverted} onInvertedChange={setRatioInverted}
        mapId="ratio" geojson={geojson} fillExpression={ratExpr} lineColor="rgba(180,180,180,0.2)"
        onMove={handleMove('ratio')} syncTarget={syncSource !== 'ratio' ? syncState : null} zoomOffset={zo}
        percentiles={stats.ratioPerc} legendStops={ratioInverted ? [...ratPal.stops].reverse() : ratPal.stops}
        legendMin="sous-servi" legendMid="mediane" legendMax="sur-servi" />
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

  // Campaign name from list
  const campaignName = campaigns.find(c => c.id === campaignId)?.name ?? '';

  const hasCampaign = !!campaignId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#050505' }}>
      {/* Top bar */}
      <DigitalToolbar
        campaigns={campaigns} selectedCampaign={campaignId} onCampaignChange={handleCampaignChange}
        scale={scale} onScaleChange={handleScaleChange}
        palette={impPalette} onPaletteChange={setImpPalette} inverted={impInverted} onInvertedChange={setImpInverted}
        popField={popField} onPopFieldChange={handlePopFieldChange}
        mediaList={mediaList} selectedMedia={selectedMedia} onMediaChange={handleMediaChange}
        loading={geojsonLoading} zonesCount={geojson?.features.length ?? 0} totalImpressions={stats.totalImp}
        filtersDisabled={!hasCampaign}
      />

      {/* Context bar — only when campaign selected */}
      {hasCampaign && (
        <CampaignContextBar
          campaignName={campaignName}
          totalImpressions={stats.totalImp}
          zonesCount={geojson?.features.length ?? 0}
          concentrationTop10={concentrationTop10}
          onOpenAnalysis={() => setAnalysisOpen(true)}
        />
      )}

      {/* Layout selector — only when campaign selected */}
      {hasCampaign && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 16px', background: '#0a0a0a', borderBottom: '0.5px solid #1a1a1a', flexShrink: 0 }}>
          <LayoutButtons layout={layout} onChange={setLayout} />
          <button onClick={() => setAnalysisOpen(v => !v)} style={{
            padding: '4px 10px', fontSize: 10, fontFamily: fInter, cursor: 'pointer', marginLeft: 'auto',
            background: analysisOpen ? 'rgba(78,205,196,0.12)' : 'transparent',
            border: `0.5px solid ${analysisOpen ? '#4ecdc4' : '#1a1a1a'}`,
            borderRadius: 3, color: analysisOpen ? '#4ecdc4' : '#8a8a8a',
          }}>{analysisOpen ? 'Fermer analyse' : 'Ouvrir analyse'}</button>
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!hasCampaign ? (
          /* Welcome state — no campaign selected */
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
                <div style={{ flex: 1, display: 'flex', gap: 1, background: '#1a1a1a', minHeight: 0 }}>
                  {allKeys.map(k => <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{makePanel(k, false)}</div>)}
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', gap: 1, background: '#1a1a1a', minHeight: 0 }}>
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

            {/* Analysis overlay */}
            <div style={{
              position: 'absolute', inset: 0, zIndex: 40, background: '#0a0a0f',
              opacity: analysisOpen ? 1 : 0, pointerEvents: analysisOpen ? 'auto' : 'none',
              transition: 'opacity 0.3s ease',
              display: 'flex', flexDirection: 'column',
            }}>
              <AnalysisPanel
                campaignId={campaignId}
                scale={scale}
                popField={popField}
                selectedMedia={selectedMedia}
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
