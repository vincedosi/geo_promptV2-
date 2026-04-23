'use client';

import { adminFetch } from '@/lib/admin-fetch';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Eye, Users, TrendingUp, Globe, Award, Star, Activity, Lightbulb, Sparkles } from 'lucide-react';
import { BreakdownChart } from '@/app/map/analyse/digital/_components/BreakdownChart';
import { MediaHeatmap } from '@/app/map/analyse/digital/_components/MediaHeatmap';
import { ActionListTable } from '@/app/map/analyse/digital/_components/ActionListTable';
import { BiddingRecommendation } from '@/app/map/analyse/digital/_components/BiddingRecommendation';
import { BiddingCopilot } from '@/app/map/analyse/digital/_components/BiddingCopilot';
import { AiAnalysisBlock } from '@/app/map/analyse/digital/_components/AiAnalysisBlock';

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

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

export interface AnalyseV2Props {
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

type TabId = 'diagnostic' | 'recommandations' | 'ia';

// ─── Count-up hook ─────────────────────────────────────────────────────────────
// Anime une valeur numérique de 0 → target avec easeOut (emil-design-eng)
function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // easeOutCubic : démarre vite, ralentit en fin
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace('.', ',') + 'k';
  return Math.round(n).toLocaleString('fr-FR');
}
function fmtPct(n: number): string { return Math.round(n) + '%'; }
function fmtRatio(n: number): string { return n.toFixed(1); }

// ─── Score qualité géographique (dérivé local, MVP) ───────────────────────────
// Formule simple : 100 - concentration top 10% (plus la distribution est étalée,
// meilleur le score). Bornée [0, 100]. Remplaçable par le score IA quand branché.
function computeQualityScore(concentrationTop10: number, couverturePct: number): number {
  if (couverturePct === 0) return 0;
  const balance = Math.max(0, Math.min(100, 100 - (concentrationTop10 - 10)));
  return Math.round(balance);
}

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

function scoreMessage(score: number): string {
  if (score >= 75) return 'Distribution équilibrée — campagne bien calibrée.';
  if (score >= 50) return 'Distribution correcte mais optimisation possible.';
  return 'Distribution déséquilibrée — recalibrage recommandé.';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Composant principal
// ═══════════════════════════════════════════════════════════════════════════════
export function AnalyseV2({ campaignId, scale, popField, selectedMedia, metric, frequency, open, onToggle, onZoneClick }: AnalyseV2Props) {
  const [breakdownData, setBreakdownData] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'region' | 'dept' | 'cp'>('region');
  const [cpLimit, setCpLimit] = useState<number>(50);
  const [cpPopMin, setCpPopMin] = useState<number>(5000);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [drillPath, setDrillPath] = useState<DrillLevel[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('diagnostic');
  const [copilotEnabled, setCopilotEnabled] = useState(false);

  useEffect(() => {
    setDrillPath([]);
    setCopilotEnabled(false);
  }, [campaignId]);

  const inDrillDown = drillPath.length > 0;
  const lastLevel = inDrillDown ? drillPath[drillPath.length - 1] : null;
  const currentAggregation: 'region' | 'dept' | 'cp' = useMemo(() => {
    if (!lastLevel) return tab;
    return lastLevel.type === 'region' ? 'dept' : 'cp';
  }, [lastLevel, tab]);

  const parentType = lastLevel?.type ?? null;
  const parentCode = lastLevel?.code ?? null;
  const heatmapAgg = currentAggregation === 'cp' ? 'region' : currentAggregation;

  const fetchBreakdown = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setBreakdownData([]);
    try {
      const agg = currentAggregation;
      const isCp = agg === 'cp';
      const limit = isCp ? cpLimit : 100;
      let url = `/api/digital/${campaignId}/analysis?type=breakdown&aggregation=${agg}&indicator=${popField}&limit=${limit}&metric=${metric}`;
      if (isCp && cpPopMin > 0) url += `&pop_min=${cpPopMin}`;
      if (selectedMedia.length > 0) url += `&media=${selectedMedia.join(',')}`;
      if (parentType && parentCode) url += `&parent_type=${parentType}&parent_code=${encodeURIComponent(parentCode)}`;
      const res = await adminFetch(url);
      if (res.ok) setBreakdownData(await res.json());
    } catch (err: unknown) { console.error('[analyseV2]', err); }
    finally { setLoading(false); }
  }, [campaignId, currentAggregation, popField, selectedMedia, cpLimit, cpPopMin, metric, parentType, parentCode]);

  useEffect(() => { if (open && campaignId) fetchBreakdown(); }, [open, campaignId, fetchBreakdown]);

  const handleBarClick = useCallback((code: string) => {
    const row = breakdownData.find(r => r.code === code);
    if (row) {
      if (currentAggregation === 'region') setDrillPath([{ type: 'region', code, nom: row.nom }]);
      else if (currentAggregation === 'dept') setDrillPath(prev => [...prev, { type: 'dept', code, nom: row.nom }]);
    }
    onZoneClick?.(code);
  }, [breakdownData, currentAggregation, onZoneClick]);

  useEffect(() => {
    if (!open || !campaignId) return;
    setHeatmapLoading(true);
    adminFetch(`/api/digital/${campaignId}/analysis?type=heatmap&aggregation=${heatmapAgg}&indicator=${popField}&metric=${metric}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setHeatmapData(data); })
      .catch(() => {})
      .finally(() => setHeatmapLoading(false));
  }, [open, campaignId, heatmapAgg, popField, metric]);

  // ─── KPI computations ──────────────────────────────────────────────────────
  const totalImp = breakdownData.reduce((s, d) => s + Number(d.impressions), 0);
  const totalPop = breakdownData.reduce((s, d) => s + Number(d.pop_value || 0), 0);
  const ratioMoyen = totalPop > 0 ? totalImp / totalPop * 1000 : 0;
  const couverturePct = breakdownData.length > 0 ? 100 : 0;
  const sorted = [...breakdownData].sort((a, b) => Number(b.impressions) - Number(a.impressions));
  const top10Count = Math.max(1, Math.ceil(sorted.length * 0.1));
  const top10Imp = sorted.slice(0, top10Count).reduce((s, d) => s + Number(d.impressions), 0);
  const concentrationTop10 = totalImp > 0 ? top10Imp / totalImp * 100 : 0;
  const qualityScore = computeQualityScore(concentrationTop10, couverturePct);

  // ─── Count-up values ───────────────────────────────────────────────────────
  const animImp = useCountUp(totalImp, 700);
  const animPop = useCountUp(totalPop, 700);
  const animRatio = useCountUp(ratioMoyen, 700);
  const animCouv = useCountUp(couverturePct, 600);
  const animTop10 = useCountUp(concentrationTop10, 700);
  const animScore = useCountUp(qualityScore, 900);

  // ─── Résumé exécutif (3 lignes max, heuristique simple) ────────────────────
  const executiveSummary = useMemo(() => {
    if (breakdownData.length === 0) return null;
    const overServed = breakdownData.filter(d => d.ecart > 3).sort((a, b) => b.ecart - a.ecart);
    const underServed = breakdownData.filter(d => d.ecart < -3).sort((a, b) => a.ecart - b.ecart);
    const parts: string[] = [];
    parts.push(`La campagne couvre ${fmtPct(couverturePct)} de la population cible mais concentre ${fmtPct(concentrationTop10)} des impressions dans le top 10 % des zones.`);
    if (overServed[0]) parts.push(`${overServed[0].nom} est sur-servie de +${overServed[0].ecart.toFixed(1)} pts.`);
    if (underServed[0]) parts.push(`${underServed[0].nom} est sous-servie de ${underServed[0].ecart.toFixed(1)} pts.`);
    return parts.join(' ');
  }, [breakdownData, couverturePct, concentrationTop10]);

  if (!open) return null;

  // ─── KPI band config ───────────────────────────────────────────────────────
  const kpiItems = [
    { label: 'Impressions',   value: fmtNum(animImp),         Icon: Eye,         color: 'var(--text-primary)' },
    { label: 'Pop. cible',    value: fmtNum(animPop),         Icon: Users,       color: 'var(--text-primary)' },
    { label: 'Ratio moy.',    value: fmtRatio(animRatio),     Icon: TrendingUp,  color: 'var(--text-primary)' },
    { label: 'Couverture',    value: fmtPct(animCouv),        Icon: Globe,       color: 'var(--success)' },
    { label: 'Top 10% CP',    value: fmtPct(animTop10) + ' imp.', Icon: Award,   color: 'var(--brand-teal)' },
    { label: 'Score qualité', value: `${Math.round(animScore)}/100`, Icon: Star, color: scoreColor(qualityScore) },
  ];

  const tabs: Array<{ id: TabId; label: string; Icon: typeof Activity }> = [
    { id: 'diagnostic',      label: 'Diagnostic',       Icon: Activity },
    { id: 'recommandations', label: 'Recommandations',  Icon: Lightbulb },
    { id: 'ia',              label: 'IA',               Icon: Sparkles },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: 'var(--bg-surface)' }}>

      {/* ═════ Breadcrumb + contexte ═════ */}
      <div style={{
        flexShrink: 0, padding: '10px 24px',
        borderBottom: '0.5px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-primary)',
      }}>
        <button
          onClick={onToggle}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
            fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)',
            borderRadius: 4,
            transition: 'color var(--duration-hover) var(--ease-hover), background-color var(--duration-hover) var(--ease-hover)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-level-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
        >
          ← Retour
        </button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>|</span>
        <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
          France
          {drillPath.map(lvl => (
            <span key={lvl.type + lvl.code}>
              <span style={{ color: 'var(--text-tertiary)', margin: '0 6px' }}>›</span>
              <span style={{ color: 'var(--text-primary)' }}>{lvl.nom}</span>
            </span>
          ))}
        </span>
        {!inDrillDown && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            {(['region', 'dept', 'cp'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '4px 10px', fontFamily: fInter, fontSize: 11, cursor: 'pointer',
                  background: tab === t ? 'rgba(78,205,196,0.12)' : 'transparent',
                  border: `0.5px solid ${tab === t ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                  borderRadius: 4,
                  color: tab === t ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                  transition: 'border-color var(--duration-hover) var(--ease-hover), color var(--duration-hover) var(--ease-hover)',
                }}
              >{t === 'region' ? 'Régions' : t === 'dept' ? 'Départements' : 'Codes postaux'}</button>
            ))}
          </div>
        )}
        {inDrillDown && (
          <button
            onClick={() => setDrillPath([])}
            style={{ marginLeft: 'auto', padding: '4px 10px', fontFamily: fInter, fontSize: 11, cursor: 'pointer', background: 'transparent', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-tertiary)' }}
          >Retour France</button>
        )}
      </div>

      {/* ═════ KPI band (count-up animé) ═════ */}
      <div style={{
        flexShrink: 0, padding: '14px 24px',
        borderBottom: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-level-2)',
        display: 'flex', gap: 32, overflowX: 'auto',
      }}>
        {kpiItems.map(({ label, value, Icon, color }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 100, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon size={11} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 10.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
            </div>
            <span style={{ fontFamily: fInter, fontSize: 22, fontWeight: 500, color, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* ═════ Tabs nav ═════ */}
      <div style={{
        flexShrink: 0, padding: '0 24px',
        borderBottom: '0.5px solid var(--border-subtle)',
        display: 'flex', gap: 4,
      }}>
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px', fontFamily: fInter, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: 'transparent', border: 'none',
              borderBottom: activeTab === id ? '2px solid var(--brand-teal)' : '2px solid transparent',
              color: activeTab === id ? 'var(--brand-teal)' : 'var(--text-tertiary)',
              transition: 'color var(--duration-hover) var(--ease-hover), border-color var(--duration-hover) var(--ease-hover)',
              marginBottom: -1,
            }}
          >
            <Icon size={13} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {/* ═════ Tabs content ═════ */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)' }}>Chargement...</div>
        ) : (
          <>
            {activeTab === 'diagnostic' && (
              <DiagnosticTab
                breakdownData={breakdownData}
                currentAggregation={currentAggregation}
                metric={metric}
                handleBarClick={handleBarClick}
                heatmapData={heatmapData}
                heatmapLoading={heatmapLoading}
                heatmapAgg={heatmapAgg}
                executiveSummary={executiveSummary}
              />
            )}
            {activeTab === 'recommandations' && (
              <RecommandationsTab
                breakdownData={breakdownData}
                currentAggregation={currentAggregation}
                metric={metric}
                handleBarClick={handleBarClick}
                copilotEnabled={copilotEnabled}
                onEnableCopilot={() => setCopilotEnabled(true)}
                campaignId={campaignId}
                indicator={popField}
              />
            )}
            {activeTab === 'ia' && (
              <IATab
                qualityScore={qualityScore}
                campaignId={campaignId}
                indicator={popField}
                kpi={{ totalImpressions: totalImp, totalPop, ratioMoyen, couverturePct, concentrationTop10 }}
                breakdown={breakdownData}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab Diagnostic
// ═══════════════════════════════════════════════════════════════════════════════
interface DiagnosticTabProps {
  breakdownData: BreakdownRow[];
  currentAggregation: 'region' | 'dept' | 'cp';
  metric: 'impressions' | 'unique';
  handleBarClick: (code: string) => void;
  heatmapData: HeatmapData | null;
  heatmapLoading: boolean;
  heatmapAgg: 'region' | 'dept';
  executiveSummary: string | null;
}
function DiagnosticTab({ breakdownData, currentAggregation, metric, handleBarClick, heatmapData, heatmapLoading, heatmapAgg, executiveSummary }: DiagnosticTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 16 }}>
        <div style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <BreakdownChart data={breakdownData} aggregation={currentAggregation} metric={metric} onBarClick={handleBarClick} />
        </div>
        <div style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <MediaHeatmap data={heatmapData} loading={heatmapLoading} aggregation={heatmapAgg} metric={metric} />
        </div>
      </div>
      {executiveSummary && (
        <div style={{
          padding: '14px 18px', borderRadius: 8,
          background: 'rgba(78,205,196,0.04)',
          borderLeft: '3px solid var(--brand-teal)',
          fontFamily: fInter, fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)',
          animation: 'staggerFadeIn var(--duration-enter) var(--ease-spring) both',
        }}>
          <div style={{ fontFamily: fInter, fontSize: 10.5, fontWeight: 600, color: 'var(--brand-teal)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Lecture rapide
          </div>
          {executiveSummary}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab Recommandations
// ═══════════════════════════════════════════════════════════════════════════════
interface RecommandationsTabProps {
  breakdownData: BreakdownRow[];
  currentAggregation: 'region' | 'dept' | 'cp';
  metric: 'impressions' | 'unique';
  handleBarClick: (code: string) => void;
  copilotEnabled: boolean;
  onEnableCopilot: () => void;
  campaignId: string;
  indicator: string;
}
function RecommandationsTab({ breakdownData, currentAggregation, metric, handleBarClick, copilotEnabled, onEnableCopilot, campaignId, indicator }: RecommandationsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        <ActionListTable data={breakdownData} metric={metric} aggregation={currentAggregation} onRowClick={handleBarClick} />
      </div>
      <div style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        <BiddingRecommendation data={breakdownData} aggregation={currentAggregation} />
      </div>

      {!copilotEnabled && (
        <button
          type="button"
          onClick={onEnableCopilot}
          style={{
            padding: '12px 20px', fontFamily: fInter, fontSize: 13, fontWeight: 500,
            background: 'var(--brand-teal)', color: 'var(--bg-primary)',
            border: 'none', borderRadius: 8, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            alignSelf: 'flex-start',
            willChange: 'transform',
            transition: 'transform var(--duration-press) var(--ease-out), background-color var(--duration-hover) var(--ease-hover)',
          }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <Sparkles size={14} strokeWidth={1.75} />
          Appliquer les coefficients (Copilote bidding)
        </button>
      )}

      {copilotEnabled && (
        <div style={{
          animation: 'modalScaleIn var(--duration-enter) var(--ease-spring) both',
          willChange: 'transform, opacity',
        }}>
          <BiddingCopilot
            campaignId={campaignId}
            indicator={indicator}
            breakdown={breakdownData}
            metric={metric}
            aggregation={currentAggregation}
          />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab IA
// ═══════════════════════════════════════════════════════════════════════════════
interface IATabProps {
  qualityScore: number;
  campaignId: string;
  indicator: string;
  kpi: { totalImpressions: number; totalPop: number; ratioMoyen: number; couverturePct: number; concentrationTop10: number };
  breakdown: BreakdownRow[];
}
function IATab({ qualityScore, campaignId, indicator, kpi, breakdown }: IATabProps) {
  const animScore = useCountUp(qualityScore, 800);
  const color = scoreColor(qualityScore);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Score card animé */}
      <div style={{
        padding: '20px 24px', borderRadius: 10,
        background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
      }}>
        <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Score de qualité géographique
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: fInter, fontSize: 36, fontWeight: 500, color, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {Math.round(animScore)}
          </span>
          <span style={{ fontFamily: fMono, fontSize: 14, color: 'var(--text-tertiary)' }}>/100</span>
        </div>
        {/* Progress bar */}
        <div style={{
          height: 6, borderRadius: 3, background: 'var(--bg-primary)', overflow: 'hidden',
          border: '0.5px solid var(--border-subtle)',
        }}>
          <div style={{
            width: `${animScore}%`, height: '100%',
            background: color, borderRadius: 3,
            transition: 'width var(--duration-hover) var(--ease-out)',
            willChange: 'width',
          }} />
        </div>
        <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.55 }}>
          {scoreMessage(qualityScore)}
        </div>
      </div>

      {/* Analyse IA (bloc existant) */}
      <AiAnalysisBlock
        campaignId={campaignId}
        indicator={indicator}
        kpi={kpi}
        breakdown={breakdown}
      />
    </div>
  );
}
