'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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

type DrillLevel = { type: 'region' | 'dept'; code: string; nom: string };

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
  const [drillPath, setDrillPath] = useState<DrillLevel[]>([]);

  // Reset drill-down when campaign changes
  useEffect(() => { setDrillPath([]); }, [campaignId]);

  const inDrillDown = drillPath.length > 0;
  const lastLevel = inDrillDown ? drillPath[drillPath.length - 1] : null;

  // Agrégation effective : tab si racine, sinon un niveau sous le parent courant
  const currentAggregation: 'region' | 'dept' | 'cp' = useMemo(() => {
    if (!lastLevel) return tab;
    return lastLevel.type === 'region' ? 'dept' : 'cp';
  }, [lastLevel, tab]);

  const parentType = lastLevel?.type ?? null;
  const parentCode = lastLevel?.code ?? null;

  // Heatmap follows the breakdown aggregation
  const heatmapAgg = currentAggregation === 'cp' ? 'region' : currentAggregation;

  const fetchBreakdown = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setBreakdownData([]); // Reset to prevent stale data
    try {
      const agg = currentAggregation;
      const isCp = agg === 'cp';
      const limit = isCp ? cpLimit : 100;
      let url = `/api/digital/${campaignId}/analysis?type=breakdown&aggregation=${agg}&indicator=${popField}&limit=${limit}&metric=${metric}`;
      if (isCp && cpPopMin > 0) url += `&pop_min=${cpPopMin}`;
      if (selectedMedia.length > 0) url += `&media=${selectedMedia.join(',')}`;
      if (parentType && parentCode) url += `&parent_type=${parentType}&parent_code=${encodeURIComponent(parentCode)}`;
      console.log(`[Breakdown] fetching: ${url}`);
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        console.log(`[Breakdown] agg=${agg} parent=${parentType ?? '-'}/${parentCode ?? '-'} rows=${data.length} first_nom=${data[0]?.nom ?? 'N/A'}`);
        setBreakdownData(data);
      }
    } catch (err) { console.error('[analysis]', err); }
    finally { setLoading(false); }
  }, [campaignId, currentAggregation, popField, selectedMedia, cpLimit, cpPopMin, metric, parentType, parentCode]);

  useEffect(() => { if (open && campaignId) fetchBreakdown(); }, [open, campaignId, fetchBreakdown]);

  // Click handler — drills down when region or dept is clicked, propagates to map if given
  const handleBarClick = useCallback((code: string) => {
    const row = breakdownData.find(r => r.code === code);
    if (row) {
      if (currentAggregation === 'region') {
        setDrillPath([{ type: 'region', code, nom: row.nom }]);
      } else if (currentAggregation === 'dept') {
        setDrillPath(prev => [...prev, { type: 'dept', code, nom: row.nom }]);
      }
      // cp level: no further drill-down
    }
    onZoneClick?.(code);
  }, [breakdownData, currentAggregation, onZoneClick]);

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

      {/* Aggregation tabs OR breadcrumb — sticky */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '0.5px solid #1a1a1a', flexShrink: 0, padding: '0 24px', minHeight: 36 }}>
        {inDrillDown ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0', fontFamily: fInter, fontSize: 12 }}>
            <button
              onClick={() => setDrillPath([])}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgba(255,255,255,0.4)', fontFamily: fInter, fontSize: 12, transition: 'color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#4ecdc4'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
            >France</button>
            {drillPath.map((level, i) => {
              const isLast = i === drillPath.length - 1;
              return (
                <span key={level.type + level.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'rgba(255,255,255,0.2)' }}>›</span>
                  <button
                    onClick={() => setDrillPath(drillPath.slice(0, i + 1))}
                    style={{
                      background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer',
                      padding: 0, fontFamily: fInter, fontSize: 12,
                      color: isLast ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)',
                      fontWeight: isLast ? 500 : 400,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => { if (!isLast) e.currentTarget.style.color = '#4ecdc4'; }}
                    onMouseLeave={e => { if (!isLast) e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                  >{level.nom}</button>
                </span>
              );
            })}
          </div>
        ) : (
          ([['region', 'Regions'], ['dept', 'Departements'], ['cp', 'Codes postaux']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: 'pointer',
              background: tab === id ? '#111111' : 'transparent',
              border: 'none', borderBottom: tab === id ? '2px solid #4ecdc4' : '2px solid transparent',
              color: tab === id ? '#4ecdc4' : '#666666',
            }}>{label}</button>
          ))
        )}
        <div style={{ flex: 1 }} />
        {currentAggregation === 'cp' && (
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
              <BreakdownChart data={breakdownData} aggregation={currentAggregation} metric={metric} onBarClick={handleBarClick} />
            </div>

            {/* Col 2: Heatmap */}
            <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
              <MediaHeatmap data={heatmapData} loading={heatmapLoading} aggregation={heatmapAgg} metric={metric} onAggregationChange={() => {}} />
            </div>

            {/* Col 1: Action List */}
            <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
              <ActionListTable data={breakdownData} metric={metric} onRowClick={handleBarClick} />
            </div>

            {/* Col 2: Bidding Recommendation */}
            <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
              <BiddingRecommendation data={breakdownData} aggregation={currentAggregation} />
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
