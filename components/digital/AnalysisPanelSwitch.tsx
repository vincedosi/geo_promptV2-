'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AnalysisPanel } from '@/app/map/analyse/digital/_components/AnalysisPanel';
import { AnalyseV2 } from '@/components/digital/AnalyseV2';

const fInter = "'Inter', system-ui, sans-serif";

export interface AnalysisPanelSwitchProps {
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

/**
 * Wrapper qui monte soit l'ancienne AnalysisPanel (V1), soit AnalyseV2.
 * Toggle visible en haut à droite. Pas de changement sur V1 — le composant
 * existant reste intact pour faciliter le retrait de V1 après validation.
 */
export function AnalysisPanelSwitch(props: AnalysisPanelSwitchProps) {
  // Persist le choix utilisateur pour cette session (localStorage volontairement
  // évité pour MVP — le toggle est une feature de preview)
  const [useV2, setUseV2] = useState<boolean>(false);

  if (!props.open) return null;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Toggle flottant V1/V2 — haut droite, au-dessus du contenu */}
      <div
        style={{
          position: 'absolute', top: 10, right: 20, zIndex: 60,
          display: 'inline-flex', alignItems: 'center',
          background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
          borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}
      >
        <button
          type="button"
          onClick={() => setUseV2(false)}
          aria-pressed={!useV2}
          title="Vue classique"
          style={{
            padding: '5px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            background: !useV2 ? 'var(--bg-level-2)' : 'transparent',
            color: !useV2 ? 'var(--text-primary)' : 'var(--text-tertiary)',
            border: 'none',
            transition: 'color var(--duration-hover) var(--ease-hover), background-color var(--duration-hover) var(--ease-hover)',
          }}
        >V1</button>
        <button
          type="button"
          onClick={() => setUseV2(true)}
          aria-pressed={useV2}
          title="Nouvelle vue"
          style={{
            padding: '5px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            background: useV2 ? 'rgba(78,205,196,0.12)' : 'transparent',
            color: useV2 ? 'var(--brand-teal)' : 'var(--text-tertiary)',
            border: 'none', borderLeft: '0.5px solid var(--border-default)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            transition: 'color var(--duration-hover) var(--ease-hover), background-color var(--duration-hover) var(--ease-hover)',
          }}
        >
          V2
          <Sparkles size={11} strokeWidth={1.75} />
        </button>
      </div>

      {/* Contenu — crossfade animé entre V1 et V2 */}
      <div
        key={useV2 ? 'v2' : 'v1'}
        style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          animation: 'staggerFadeIn var(--duration-enter) var(--ease-spring) both',
          willChange: 'transform, opacity',
        }}
      >
        {useV2 ? <AnalyseV2 {...props} /> : <AnalysisPanel {...props} />}
      </div>
    </div>
  );
}
