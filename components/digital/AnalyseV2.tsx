'use client';

import { adminFetch } from '@/lib/admin-fetch';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Eye, Users, TrendingUp, Globe, Award, Star, Activity, Lightbulb, Info } from 'lucide-react';
import { BreakdownChart } from '@/app/map/analyse/digital/_components/BreakdownChart';
import { MediaHeatmap } from '@/app/map/analyse/digital/_components/MediaHeatmap';
import { ActionListTable } from '@/app/map/analyse/digital/_components/ActionListTable';
import { BiddingRecommendation } from '@/app/map/analyse/digital/_components/BiddingRecommendation';

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
  metric: string;
  frequency?: number | null;
  open: boolean;
  onToggle: () => void;
  onZoneClick?: (code: string) => void;
}

type TabId = 'diagnostic' | 'recommandations' | 'score';

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
// meilleur le score). Bornée [0, 100].
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

// ─── Définitions des KPI (tooltips au survol) ─────────────────────────────────
// Centralisé ici pour cohérence : si tu vois ce label dans la KPI band et
// dans l'onglet Score qualité, le texte explicatif est strictement identique.
const KPI_DEFINITIONS: Record<string, string> = {
  'Impressions':   'Nombre total de diffusions enregistrées sur la zone analysée. Source : table dsp_campaign_data.',
  'Pop. cible':    'Population correspondant à l\'indicateur sélectionné (Population, 25-49 ans, etc.) sur la zone analysée. Source : carreaux Filosofi INSEE.',
  'Ratio moy.':    'Impressions / Population × 1000. Représente l\'intensité moyenne de diffusion par millier d\'individus de la cible.',
  'Couverture':    'Pourcentage de zones (régions / départements / codes postaux) avec au moins 1 impression. 100% = présence partout.',
  'Top 10% CP':    'Part des impressions concentrées dans les 10 % de zones les plus exposées. Plus c\'est élevé, plus la campagne est concentrée.',
  'Score qualité': 'Score heuristique 0-100 basé sur l\'écart entre la distribution réelle et une distribution équilibrée. Formule : 100 − max(0, concentration_top10 − 10). Une distribution étalée donne un score élevé.',
};
// Le score de l'onglet Score qualité est strictement le même que la KPI "Score qualité" —
// on partage donc la même définition pour éviter la confusion utilisateur.
const SCORE_GEO_DEFINITION = KPI_DEFINITIONS['Score qualité'];

// ─── Tooltip helper — state-driven (fiable, échappe les conteneurs overflow) ──
function InfoTooltip({ text, side = 'bottom' }: { text: string; side?: 'top' | 'bottom' }) {
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Calcule la position absolute via document.body coordinates pour échapper
  // tout ancestor avec overflow: hidden / auto (le panel d'analyse en a un)
  useEffect(() => {
    if (!hover || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 260;
    const tooltipApproxHeight = 90;
    const margin = 8;
    let left = r.left + r.width / 2 - tooltipWidth / 2;
    // Clamp horizontalement à la viewport
    if (left < margin) left = margin;
    if (left + tooltipWidth > window.innerWidth - margin) left = window.innerWidth - tooltipWidth - margin;
    // Position verticale : sous le trigger sauf si pas la place
    let top = r.bottom + margin;
    const willOverflowBottom = top + tooltipApproxHeight > window.innerHeight - margin;
    if (side === 'top' || willOverflowBottom) top = r.top - tooltipApproxHeight - margin;
    setCoords({ top, left });
  }, [hover, side]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        tabIndex={0}
        aria-label="Plus d'informations"
        style={{
          display: 'inline-flex', alignItems: 'center',
          cursor: 'help', outline: 'none',
        }}
      >
        <Info
          size={12}
          strokeWidth={2}
          style={{
            color: hover ? 'var(--brand-teal)' : 'var(--text-tertiary)',
            flexShrink: 0,
            transition: 'color var(--duration-hover) var(--ease-hover)',
          }}
        />
      </span>
      {/* Portal vers document.body pour échapper overflow ancestors */}
      {mounted && hover && coords && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: 260, padding: '10px 12px',
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
            borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 11.5, lineHeight: 1.55,
            color: 'var(--text-secondary)',
            zIndex: 10000,
            whiteSpace: 'normal',
            pointerEvents: 'none',
            animation: 'staggerFadeIn 150ms var(--ease-spring) both',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
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

  useEffect(() => {
    setDrillPath([]);
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

  // ─── KPI band config — chaque accent porte un sens sémantique ─────────────
  // Couleurs tenues : teal (perf/measure), success (couverture), analysis
  // (concentration), score dynamique. Le reste reste neutre.
  const kpiItems: Array<{
    label: string; value: string; Icon: typeof Eye;
    accent: string; accentRgb: string;
  }> = [
    { label: 'Impressions',   value: fmtNum(animImp),                accent: 'var(--brand-teal)',   accentRgb: '78,205,196',  Icon: Eye },
    { label: 'Pop. cible',    value: fmtNum(animPop),                accent: 'var(--cat-context)',  accentRgb: '138,138,138', Icon: Users },
    { label: 'Ratio moy.',    value: fmtRatio(animRatio),            accent: 'var(--brand-teal)',   accentRgb: '78,205,196',  Icon: TrendingUp },
    { label: 'Couverture',    value: fmtPct(animCouv),               accent: 'var(--success)',      accentRgb: '61,255,160',  Icon: Globe },
    { label: 'Top 10% CP',    value: fmtPct(animTop10) + ' imp.',    accent: 'var(--cat-analysis)', accentRgb: '232,132,92',  Icon: Award },
    { label: 'Score qualité', value: `${Math.round(animScore)}/100`, accent: scoreColor(qualityScore), accentRgb: qualityScore >= 75 ? '61,255,160' : qualityScore >= 50 ? '247,183,49' : '255,87,87', Icon: Star },
  ];

  const tabs: Array<{ id: TabId; label: string; Icon: typeof Activity }> = [
    { id: 'diagnostic',      label: 'Diagnostic',       Icon: Activity },
    { id: 'recommandations', label: 'Recommandations',  Icon: Lightbulb },
    { id: 'score',           label: 'Score qualité',    Icon: Star },
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

      {/* ═════ KPI band — cards compartimentées avec accent couleur tenu ═════ */}
      <div style={{
        flexShrink: 0, padding: '16px 24px',
        borderBottom: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-primary)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10,
      }}>
        {kpiItems.map(({ label, value, Icon, accent, accentRgb }) => {
          const definition = KPI_DEFINITIONS[label];
          return (
            <div
              key={label}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--border-subtle)',
                borderTop: `2px solid rgba(${accentRgb}, 0.6)`,
                borderRadius: 8,
                transition: 'border-color var(--duration-hover) var(--ease-hover), transform var(--duration-press) var(--ease-out)',
                cursor: 'default',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `rgba(${accentRgb}, 0.4)`; e.currentTarget.style.borderTopColor = accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.borderTopColor = `rgba(${accentRgb}, 0.6)`; }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 7, flexShrink: 0,
                background: `rgba(${accentRgb}, 0.10)`,
                border: `0.5px solid rgba(${accentRgb}, 0.25)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: accent,
              }}>
                <Icon size={14} strokeWidth={1.75} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                  {definition && <InfoTooltip text={definition} side="bottom" />}
                </div>
                <span style={{ fontFamily: fInter, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.2, marginTop: 1 }}>{value}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═════ Tabs nav — pills compartimentées ═════ */}
      <div style={{
        flexShrink: 0, padding: '12px 24px 0',
        background: 'var(--bg-primary)',
        display: 'flex', gap: 6,
        borderBottom: '0.5px solid var(--border-subtle)',
      }}>
        {tabs.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-pressed={active}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 14px 10px', fontFamily: fInter, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                background: active ? 'var(--bg-surface)' : 'transparent',
                border: '0.5px solid',
                borderColor: active ? 'var(--border-default)' : 'transparent',
                borderBottomColor: active ? 'var(--bg-surface)' : 'transparent',
                borderRadius: '8px 8px 0 0',
                color: active ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                marginBottom: -0.5,
                transition: 'color var(--duration-hover) var(--ease-hover), background-color var(--duration-hover) var(--ease-hover), border-color var(--duration-hover) var(--ease-hover)',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-level-2)'; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; } }}
            >
              <Icon size={13} strokeWidth={1.75} />
              {label}
              {active && (
                <span style={{
                  position: 'absolute', bottom: -1, left: 12, right: 12, height: 2,
                  background: 'var(--brand-teal)',
                  borderRadius: '2px 2px 0 0',
                }} />
              )}
            </button>
          );
        })}
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
              />
            )}
            {activeTab === 'score' && (
              <OngletScore
                qualityScore={qualityScore}
                animScore={animScore}
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
  metric: string;
  handleBarClick: (code: string) => void;
  heatmapData: HeatmapData | null;
  heatmapLoading: boolean;
  heatmapAgg: 'region' | 'dept';
  executiveSummary: string | null;
}
function DiagnosticTab({ breakdownData, currentAggregation, metric, handleBarClick, heatmapData, heatmapLoading, heatmapAgg, executiveSummary }: DiagnosticTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Résumé exécutif en haut — accent teal, plus visible */}
      {executiveSummary && (
        <div style={{
          padding: '16px 20px', borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(78,205,196,0.08), rgba(78,205,196,0.02))',
          border: '0.5px solid rgba(78,205,196,0.25)',
          display: 'flex', gap: 14, alignItems: 'flex-start',
          animation: 'staggerFadeIn var(--duration-enter) var(--ease-spring) both',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: 'rgba(78,205,196,0.15)',
            border: '0.5px solid rgba(78,205,196,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--brand-teal)',
          }}>
            <Activity size={16} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: fInter, fontSize: 10.5, fontWeight: 600, color: 'var(--brand-teal)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Lecture rapide
            </div>
            <div style={{ fontFamily: fInter, fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-primary)' }}>
              {executiveSummary}
            </div>
          </div>
        </div>
      )}

      {/* 2 cards graphique + heatmap */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 16 }}>
        <SectionCard title="Écart impressions vs population" subtitle="Distribution par zone — clic pour drilldown" accentRgb="78,205,196">
          <BreakdownChart data={breakdownData} aggregation={currentAggregation} metric={metric} onBarClick={handleBarClick} />
        </SectionCard>
        <SectionCard title="Régies × géographie" subtitle="Heatmap divergente sur l'écart" accentRgb="232,132,92">
          <MediaHeatmap data={heatmapData} loading={heatmapLoading} aggregation={heatmapAgg} metric={metric} />
        </SectionCard>
      </div>
    </div>
  );
}

// ─── SectionCard helper réutilisable ───────────────────────────────────────────
function SectionCard({ title, subtitle, accentRgb, children }: { title: string; subtitle?: string; accentRgb: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-level-2)',
      border: '0.5px solid var(--border-subtle)',
      borderRadius: 10,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '11px 16px',
        borderBottom: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: `rgb(${accentRgb})`,
          boxShadow: `0 0 0 2px rgba(${accentRgb},0.18)`,
          flexShrink: 0,
        }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: fInter, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.005em' }}>{title}</span>
          {subtitle && <span style={{ fontFamily: fInter, fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 1 }}>{subtitle}</span>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab Recommandations
// ═══════════════════════════════════════════════════════════════════════════════
interface RecommandationsTabProps {
  breakdownData: BreakdownRow[];
  currentAggregation: 'region' | 'dept' | 'cp';
  metric: string;
  handleBarClick: (code: string) => void;
}
function RecommandationsTab({ breakdownData, currentAggregation, metric, handleBarClick }: RecommandationsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SectionCard title="Sur-servis & sous-servis" subtitle="Tri par écart absolu — clic pour drilldown sur la carte" accentRgb="91,155,213">
        <ActionListTable data={breakdownData} metric={metric} aggregation={currentAggregation} onRowClick={handleBarClick} />
      </SectionCard>

      <SectionCard title="Recommandation bidding" subtitle="Coefficients calculés depuis l'écart pop/imp" accentRgb="247,183,49">
        <BiddingRecommendation data={breakdownData} aggregation={currentAggregation} />
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Onglet Score qualité (onglet « IA » jusqu'au 2026-10-12 : son diagnostic
// Gemini a été retiré avec toute l'IA, le score — calculé localement — reste)
// ═══════════════════════════════════════════════════════════════════════════════
interface OngletScoreProps {
  /** Valeur cible (0-100) — pour la couleur, le donut, le message */
  qualityScore: number;
  /** Valeur ANIMÉE en cours — partagée avec la KPI band du parent.
   *  Garantit que les 2 affichages du score restent strictement synchronisés
   *  (évite l'ancien bug 82 vs 55 dû à 2 useCountUp parallèles à durées
   *  différentes). */
  animScore: number;
}
function OngletScore({ qualityScore, animScore }: OngletScoreProps) {
  const color = scoreColor(qualityScore);
  const colorRgb = qualityScore >= 75 ? '61,255,160' : qualityScore >= 50 ? '247,183,49' : '255,87,87';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ═════ Score card prominent — gradient subtil + ring autour du nombre ═════ */}
      <div style={{
        padding: '24px 28px', borderRadius: 12,
        background: `linear-gradient(135deg, rgba(${colorRgb},0.10), rgba(${colorRgb},0.02))`,
        border: `0.5px solid rgba(${colorRgb},0.25)`,
        borderTop: `3px solid ${color}`,
        display: 'flex', alignItems: 'center', gap: 24,
        animation: 'staggerFadeIn var(--duration-enter) var(--ease-spring) both',
      }}>
        {/* Score circulaire visuellement marquant */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 96, height: 96, borderRadius: '50%',
            background: `conic-gradient(${color} 0% ${animScore}%, rgba(${colorRgb},0.15) ${animScore}% 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background var(--duration-hover) var(--ease-out)',
          }}>
            <div style={{
              width: 78, height: 78, borderRadius: '50%',
              background: 'var(--bg-surface)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              border: `0.5px solid rgba(${colorRgb},0.3)`,
            }}>
              <span style={{ fontFamily: fInter, fontSize: 28, fontWeight: 600, color, letterSpacing: '-0.02em', lineHeight: 1 }}>
                {Math.round(animScore)}
              </span>
              <span style={{ fontFamily: fMono, fontSize: 9.5, color: 'var(--text-tertiary)', marginTop: 2 }}>/ 100</span>
            </div>
          </div>
        </div>

        {/* Titre + message */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Star size={14} strokeWidth={2} style={{ color }} />
            <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Score de qualité géographique
            </span>
            <InfoTooltip text={SCORE_GEO_DEFINITION} side="bottom" />
            <span style={{ fontFamily: fInter, fontSize: 9.5, color: 'var(--text-tertiary)', padding: '1px 6px', background: 'var(--bg-primary)', border: '0.5px solid var(--border-subtle)', borderRadius: 3, marginLeft: 'auto' }}>
              identique au KPI &laquo;&nbsp;Score qualité&nbsp;&raquo;
            </span>
          </div>
          <div style={{ fontFamily: fInter, fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 6 }}>
            {scoreMessage(qualityScore)}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            <ScoreLegend label="0-49" color="var(--danger)" active={qualityScore < 50} />
            <ScoreLegend label="50-74" color="var(--warning)" active={qualityScore >= 50 && qualityScore < 75} />
            <ScoreLegend label="75-100" color="var(--success)" active={qualityScore >= 75} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreLegend({ label, color, active }: { label: string; color: string; active: boolean }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      opacity: active ? 1 : 0.45,
      transition: 'opacity var(--duration-hover) var(--ease-hover)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontFamily: fMono, fontSize: 10.5, color: active ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
}
