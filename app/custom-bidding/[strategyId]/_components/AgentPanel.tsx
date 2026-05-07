'use client';

/**
 * AgentPanel — container collapsible intégré dans l'overlay Pilotage ML.
 * 5 onglets : Conseils (recommandations), Drift, Chat, Auto-pilot, Logs.
 * Persiste l'état d'ouverture en localStorage.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Activity, MessageSquare, Bot, ScrollText, FileCheck2 } from 'lucide-react';
import { AgentRecommendations } from './AgentRecommendations';
import { AgentDrifts } from './AgentDrifts';
import { AgentChat } from './AgentChat';
import { AgentAutoPilot } from './AgentAutoPilot';
import { AgentLogs } from './AgentLogs';
import { CampaignJournal } from './CampaignJournal';
import { FinalReport } from './FinalReport';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const STORAGE_KEY = 'geomatik:pilotage-ml:agent-panel-open:v1';

type Tab = 'reco' | 'drift' | 'chat' | 'auto' | 'journal' | 'report';

const ALL_TABS: { id: Tab; label: string; Icon: typeof Sparkles }[] = [
  { id: 'reco',    label: 'Conseils',   Icon: Sparkles },
  { id: 'drift',   label: 'Drift',      Icon: Activity },
  { id: 'chat',    label: 'Chat',       Icon: MessageSquare },
  { id: 'auto',    label: 'Auto-pilot', Icon: Bot },
  { id: 'journal', label: 'Journal',    Icon: ScrollText },
  { id: 'report',  label: 'Bilan',      Icon: FileCheck2 },
];

const SIMPLE_TABS_COMPLETED: Tab[] = ['report', 'journal'];
const SIMPLE_TABS_ACTIVE: Tab[] = ['reco', 'journal'];

interface Props {
  strategyId: string;
  onApplied?: () => void;
  /** Si true, l'onglet par défaut est 'report' au lieu de 'reco'. */
  isCompleted?: boolean;
  /** 'simple' restreint à 2 onglets pertinents, 'expert' affiche tous les onglets. */
  viewMode?: 'simple' | 'expert';
}

export function AgentPanel({ strategyId, onApplied, isCompleted, viewMode = 'simple' }: Props) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>(isCompleted ? 'report' : 'reco');
  const [hydrated, setHydrated] = useState(false);

  const visibleTabs = viewMode === 'expert'
    ? ALL_TABS
    : ALL_TABS.filter(t => (isCompleted ? SIMPLE_TABS_COMPLETED : SIMPLE_TABS_ACTIVE).includes(t.id));

  // Si l'onglet courant n'est pas visible dans le mode actuel, switch sur le premier visible
  useEffect(() => {
    if (!visibleTabs.find(t => t.id === tab)) {
      setTab(visibleTabs[0]?.id ?? 'reco');
    }
  }, [viewMode, isCompleted, tab, visibleTabs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === '0') setOpen(false);
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try { window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch { /* ignore */ }
  }, [open, hydrated]);

  return (
    <div
      style={{
        margin: '12px',
        borderRadius: 10,
        overflow: 'hidden',
        border: '0.5px solid var(--brand-teal)',
        borderLeft: '3px solid var(--brand-teal)',
        background: 'var(--bg-level-1)',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: open ? '0.5px solid var(--border-subtle)' : 'none',
          fontFamily: fInter,
        }}
      >
        <Sparkles size={14} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          MAGELIAN Agent
        </span>
        <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          gemini-2.5-flash · vrai LLM
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '5px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
            background: 'transparent', color: 'var(--text-secondary)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 5, cursor: 'pointer',
          }}
        >
          {open ? <><ChevronUp size={12} /> Réduire</> : <><ChevronDown size={12} /> Ouvrir</>}
        </button>
      </div>

      {open && (
        <>
          <div
            style={{
              display: 'flex', gap: 0,
              padding: '0 8px',
              borderBottom: '0.5px solid var(--border-subtle)',
              background: 'var(--bg-level-2)',
            }}
          >
            {visibleTabs.map(t => {
              const active = t.id === tab;
              const Icon = t.Icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px',
                    fontSize: 11, fontFamily: fInter, fontWeight: 500,
                    background: 'transparent',
                    color: active ? 'var(--brand-teal)' : 'var(--text-secondary)',
                    border: 'none',
                    borderBottom: `2px solid ${active ? 'var(--brand-teal)' : 'transparent'}`,
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={12} strokeWidth={1.8} />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div style={{ minHeight: 200, background: 'var(--bg-level-1)' }}>
            {tab === 'reco'    && <AgentRecommendations strategyId={strategyId} onApplied={onApplied} />}
            {tab === 'drift'   && <AgentDrifts strategyId={strategyId} onApplied={onApplied} />}
            {tab === 'chat'    && <AgentChat strategyId={strategyId} />}
            {tab === 'auto'    && <AgentAutoPilot strategyId={strategyId} />}
            {tab === 'journal' && <CampaignJournal strategyId={strategyId} />}
            {tab === 'report'  && <FinalReport strategyId={strategyId} />}
          </div>
        </>
      )}
    </div>
  );
}
