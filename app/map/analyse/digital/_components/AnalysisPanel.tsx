'use client';

import { useState, useEffect, useCallback } from 'react';
import { KpiSummary } from './KpiSummary';
import { BreakdownChart } from './BreakdownChart';
import { ActionListTable } from './ActionListTable';
import { MediaHeatmap } from './MediaHeatmap';
import { AiAnalysisBlock } from './AiAnalysisBlock';
import { BiddingRecommendation } from './BiddingRecommendation';

const fInter = "'Inter', sans-serif";

interface BreakdownRow {
  code: string; nom: string; impressions: number; pop_value: number;
  pct_imp: number; pct_pop: number; ecart: number;
}

interface HeatmapData {
  medias: string[];
  zones: { code: string; nom: string }[];
  cells: Array<{ media: string; zone_code: string; zone_nom: string; impressions: number; pop_cible: number; pct_imp_media: number; pct_pop: number; ecart: number }>;
}

interface AnalysisPanelProps {
  campaignId: string;
  scale: string;
  popField: string;
  selectedMedia: string[];
  metric: 'impressions' | 'unique';
  frequency?: number | null;
  open: boolean;
  onToggle: () => void;
  onZoneClick?: (code: string) => void;
}

export function AnalysisPanel({ campaignId, scale, popField, selectedMedia, metric, frequency, open, onToggle, onZoneClick }: AnalysisPanelProps) {
  const [breakdownData, setBreakdownData] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'region' | 'dept' | 'cp'>('region');
  const [cpLimit, setCpLimit] = useState<number>(50);
  const [cpPopMin, setCpPopMin] = useState<number>(5000);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  // Heatmap follows the breakdown tab
  const heatmapAgg = tab === 'cp' ? 'region' : tab; // CP → region for heatmap (too many columns otherwise)

  const fetchBreakdown = useCallback(async (agg: string) => {
    if (!campaignId) return;
    setLoading(true);
    setBreakdownData([]); // Reset to prevent stale data
    try {
      const isCp = agg === 'cp';
      const limit = isCp ? cpLimit : 100;
      let url = `/api/digital/${campaignId}/analysis?type=breakdown&aggregation=${agg}&indicator=${popField}&limit=${limit}&metric=${metric}`;
      if (isCp && cpPopMin > 0) url += `&pop_min=${cpPopMin}`;
      if (selectedMedia.length > 0) url += `&media=${selectedMedia.join(',')}`;
      console.log(`[Breakdown] fetching: ${url}`);
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        console.log(`[Breakdown] agg=${agg} rows=${data.length} first_nom=${data[0]?.nom ?? 'N/A'}`);
        setBreakdownData(data);
      }
    } catch (err) { console.error('[analysis]', err); }
    finally { setLoading(false); }
  }, [campaignId, popField, selectedMedia, cpLimit, cpPopMin, metric]);

  useEffect(() => { if (open && campaignId) fetchBreakdown(tab); }, [open, campaignId, tab, popField, selectedMedia, cpLimit, cpPopMin, metric, fetchBreakdown]);

  useEffect(() => {
    if (!open || !campaignId) return;
    setHeatmapLoading(true);
    fetch(`/api/digital/${campaignId}/analysis?type=heatmap&aggregation=${heatmapAgg}&indicator=${popField}&metric=${metric}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setHeatmapData(data); })
      .catch(() => {})
      .finally(() => setHeatmapLoading(false));
  }, [open, campaignId, heatmapAgg, popField, metric]);

  const totalImp = breakdownData.reduce((s, d) => s + Number(d.impressions), 0);
  const totalPop = breakdownData.reduce((s, d) => s + Number(d.pop_value || 0), 0);
  const ratioMoyen = totalPop > 0 ? totalImp / totalPop * 1000 : 0;
  const sorted = [...breakdownData].sort((a, b) => Number(b.impressions) - Number(a.impressions));
  const top10Count = Math.max(1, Math.ceil(sorted.length * 0.1));
  const top10Imp = sorted.slice(0, top10Count).reduce((s, d) => s + Number(d.impressions), 0);
  const concentrationTop10 = totalImp > 0 ? top10Imp / totalImp * 100 : 0;

  if (!open) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: '#0a0a0f' }}>
      {/* KPI bar — sticky top */}
      <div style={{ flexShrink: 0, borderBottom: '0.5px solid #1a1a1a', padding: '6px 24px' }}>
        <KpiSummary
          totalImpressions={totalImp} totalPop={totalPop} ratioMoyen={ratioMoyen}
          couverturePct={breakdownData.length > 0 ? 100 : 0} concentrationTop10={concentrationTop10}
          metric={metric} frequency={frequency ?? null}
        />
      </div>

      {/* Aggregation tabs — sticky */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #1a1a1a', flexShrink: 0, padding: '0 24px' }}>
        {([['region', 'Regions'], ['dept', 'Departements'], ['cp', 'Codes postaux']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: 'pointer',
            background: tab === id ? '#111111' : 'transparent',
            border: 'none', borderBottom: tab === id ? '2px solid #4ecdc4' : '2px solid transparent',
            color: tab === id ? '#4ecdc4' : '#666666',
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === 'cp' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'center', marginRight: 8 }}>
            <select
              value={cpLimit}
              onChange={(e) => setCpLimit(parseInt(e.target.value, 10))}
              style={{
                background: '#111111', border: '0.5px solid #262626', borderRadius: 4,
                padding: '4px 8px', fontFamily: fInter, fontSize: 11, color: '#a0a0a0',
                outline: 'none', cursor: 'pointer',
              }}
            >
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
            </select>
            <select
              value={cpPopMin}
              onChange={(e) => setCpPopMin(parseInt(e.target.value, 10))}
              style={{
                background: '#111111', border: '0.5px solid #262626', borderRadius: 4,
                padding: '4px 8px', fontFamily: fInter, fontSize: 11, color: '#a0a0a0',
                outline: 'none', cursor: 'pointer',
              }}
            >
              <option value={0}>Pop. toutes</option>
              <option value={1000}>Pop. min 1k</option>
              <option value={5000}>Pop. min 5k</option>
              <option value={10000}>Pop. min 10k</option>
              <option value={50000}>Pop. min 50k</option>
            </select>
          </div>
        )}
        <button onClick={onToggle} style={{
          padding: '6px 14px', fontFamily: fInter, fontSize: 11, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)', border: '0.5px solid #262626', borderRadius: 4,
          color: '#a0a0a0', alignSelf: 'center',
        }}>Fermer analyse</button>
      </div>

      {/* Scrollable grid */}
      <style>{`
        .analysis-grid-scroll::-webkit-scrollbar { width: 8px; }
        .analysis-grid-scroll::-webkit-scrollbar-track { background: #0a0a0f; }
        .analysis-grid-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        .analysis-grid-scroll::-webkit-scrollbar-thumb:hover { background: #4ecdc4; }
      `}</style>
      <div className="analysis-grid-scroll" style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: 24,
        scrollbarWidth: 'thin', scrollbarColor: '#333 #0a0a0f',
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, fontFamily: fInter, fontSize: 13, color: '#666666' }}>Chargement...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Col 1: Breakdown */}
            <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
              <BreakdownChart data={breakdownData} aggregation={tab} metric={metric} onBarClick={onZoneClick} />
            </div>

            {/* Col 2: Heatmap */}
            <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
              <MediaHeatmap data={heatmapData} loading={heatmapLoading} aggregation={heatmapAgg} metric={metric} onAggregationChange={() => {}} />
            </div>

            {/* Col 1: Action List */}
            <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
              <ActionListTable data={breakdownData} metric={metric} onRowClick={onZoneClick} />
            </div>

            {/* Col 2: Bidding Recommendation */}
            <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
              <BiddingRecommendation data={breakdownData} aggregation={tab} />
            </div>

            {/* Full width: AI Analysis */}
            <div style={{ gridColumn: '1 / -1' }}>
              <AiAnalysisBlock
                campaignId={campaignId}
                indicator={popField}
                kpi={{ totalImpressions: totalImp, totalPop, ratioMoyen, couverturePct: breakdownData.length > 0 ? 100 : 0, concentrationTop10 }}
                breakdown={breakdownData}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
