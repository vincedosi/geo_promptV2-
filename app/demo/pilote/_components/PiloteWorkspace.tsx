'use client';
import { useState } from 'react';
import { PilotChatPanel } from './PilotChatPanel';
import { BilanPanel } from './BilanPanel';

type Tab = 'pilotage' | 'bilan';

export default function PiloteWorkspace() {
  const [tab, setTab] = useState<Tab>('pilotage');
  const tabStyle = (active: boolean) => ({
    padding: '10px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
    background: 'transparent', border: 'none',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
    borderBottom: active ? '2px solid var(--brand-teal)' : '2px solid transparent',
  } as const);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border-subtle)', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'pilotage')} onClick={() => setTab('pilotage')}>Pilotage</button>
        <button style={tabStyle(tab === 'bilan')} onClick={() => setTab('bilan')}>Bilan</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <div style={{ display: tab === 'pilotage' ? 'block' : 'none', height: '100%' }}>
          <PilotChatPanel />
        </div>
        {tab === 'bilan' && <BilanPanel />}
      </div>
    </div>
  );
}
