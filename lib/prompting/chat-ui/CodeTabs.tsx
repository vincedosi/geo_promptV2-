'use client';

/**
 * Pattern 5 — Onglets de code (DSP target switcher) avec actions copy/download.
 */
import { useState } from 'react';
import { DownloadButton } from './DownloadButton';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export interface CodeTab {
  id: string;
  label: string;
  code: string | null;
  filename: string;
}

export interface CodeTabsProps {
  tabs: CodeTab[];
  initialTab?: string;
}

export function CodeTabs({ tabs, initialTab }: CodeTabsProps) {
  const [active, setActive] = useState(() => initialTab ?? tabs.find(t => t.code)?.id ?? tabs[0]?.id);
  const activeTab = tabs.find(t => t.id === active);
  if (!activeTab || tabs.every(t => !t.code)) return null;

  const copy = () => {
    if (activeTab.code) navigator.clipboard.writeText(activeTab.code).catch(() => {});
  };

  return (
    <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
        {tabs.map(t => {
          const disabled = !t.code;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => !disabled && setActive(t.id)}
              disabled={disabled}
              style={{
                padding: '8px 16px', fontFamily: fInter, fontSize: 11,
                cursor: disabled ? 'default' : 'pointer',
                background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--brand-teal)' : '2px solid transparent',
                color: disabled ? 'rgba(255,255,255,0.2)' : isActive ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                opacity: disabled ? 0.5 : 1,
              }}
            >{t.label}</button>
          );
        })}
        <div style={{ flex: 1 }} />
        {activeTab.code && (
          <div style={{ display: 'flex', gap: 4, padding: '6px 10px' }}>
            <button
              onClick={copy}
              style={{
                padding: '4px 10px', fontFamily: fInter, fontSize: 10, cursor: 'pointer',
                background: 'transparent', border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 4, color: 'var(--text-secondary)',
              }}
            >Copier</button>
            <DownloadButton text={activeTab.code} filename={activeTab.filename} />
          </div>
        )}
      </div>
      <pre style={{
        margin: 0, padding: '14px 16px', background: 'rgba(0,0,0,0.3)',
        fontFamily: fMono, fontSize: 11, lineHeight: 1.5,
        color: 'var(--text-secondary)', overflowX: 'auto', maxHeight: 260,
      }}>{activeTab.code ?? '(pas de code disponible)'}</pre>
    </div>
  );
}
