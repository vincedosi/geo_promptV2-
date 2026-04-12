'use client';

import { useState, useRef, useEffect } from 'react';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

// ── Types ────────────────────────────────────────────────────────────────────

interface Campaign { id: string; name: string; total_tracked_ads: number; }
interface MediaItem { media: string; total_impressions: number; }

interface RailroadPipelineProps {
  // Data
  campaigns: Campaign[];
  popFields: { value: string; label: string }[];
  mediaList: string[];
  // Selected values
  selectedCampaign: string;
  selectedPopField: string;
  selectedScale: string;
  selectedMedia: string[];
  selectedLayout: string;
  // Callbacks
  onCampaignChange: (id: string) => void;
  onPopFieldChange: (field: string) => void;
  onScaleChange: (scale: string) => void;
  onMediaChange: (media: string[]) => void;
  onLayoutChange: (layout: string) => void;
  // Stats
  zonesCount: number;
  totalImpressions: number;
  loading: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

// ── Node component ──────────────────────────────────────────────────────────

function RailNode({ icon, label, value, done, active, onClick }: {
  icon: React.ReactNode; label: string; value: string; done: boolean; active: boolean; onClick: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative', zIndex: 2 }}>
      <button onClick={onClick} style={{
        width: 40, height: 40, borderRadius: '50%', cursor: 'pointer',
        background: done ? 'rgba(78,205,196,0.08)' : '#0a0a0a',
        border: `2px solid ${done || active ? '#4ecdc4' : '#262626'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: active ? '0 0 0 4px rgba(78,205,196,0.12)' : 'none',
        transition: 'all 0.2s',
        position: 'relative',
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ecdc4'; e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = done || active ? '#4ecdc4' : '#262626'; e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {icon}
        {active && <span style={{ position: 'absolute', inset: -6, borderRadius: '50%', border: '1px solid rgba(78,205,196,0.08)', animation: 'rrPulse 2s ease-out infinite' }} />}
      </button>
      <span style={{ fontFamily: fInter, fontSize: 9, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <button onClick={onClick} style={{
        fontFamily: fInter, fontSize: 12, fontWeight: 500, color: done ? '#f0f0f0' : '#8a8a8a',
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        transition: 'color 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.color = '#4ecdc4'; }}
        onMouseLeave={e => { e.currentTarget.style.color = done ? '#f0f0f0' : '#8a8a8a'; }}
      >{value}</button>
    </div>
  );
}

// ── Track component ──────────────────────────────────────────────────────────

function Track({ fill }: { fill: 'done' | 'current' | 'future' }) {
  const w = fill === 'done' ? '100%' : fill === 'current' ? '50%' : '0%';
  return (
    <div style={{ flex: 1, height: 40, display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1, marginTop: -28 }}>
      <div style={{ width: '100%', height: 2, background: '#1a1a1a', borderRadius: 1, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 1, width: w, background: 'linear-gradient(90deg, #4ecdc4, rgba(78,205,196,0.3))', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

// ── Popover wrapper ─────────────────────────────────────────────────────────

function Popover({ open, children, align }: { open: boolean; children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  if (!open) return null;
  const pos = align === 'left' ? { left: 0 } : align === 'right' ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' };
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 12px)', ...pos,
      background: '#0a0a0a', border: '0.5px solid #262626', borderRadius: 10, padding: 6,
      minWidth: 200, zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    }}>{children}</div>
  );
}

// ── Option items ────────────────────────────────────────────────────────────

function RadioOption({ selected, label, sub, onClick }: { selected: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6,
      background: selected ? '#181818' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
      transition: 'background 0.1s',
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#181818'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.5px solid ${selected ? '#4ecdc4' : '#333'}`, background: selected ? '#4ecdc4' : 'transparent', flexShrink: 0 }} />
      <div>
        <div style={{ fontFamily: fInter, fontSize: 12, color: selected ? '#f0f0f0' : '#b0b0b0' }}>{label}</div>
        {sub && <div style={{ fontFamily: fMono, fontSize: 10, color: '#8a8a8a' }}>{sub}</div>}
      </div>
    </button>
  );
}

function CheckOption({ checked, label, sub, onClick }: { checked: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6,
      background: checked ? '#181818' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
    }}
      onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#181818'; }}
      onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${checked ? '#4ecdc4' : '#333'}`,
        background: checked ? '#4ecdc4' : 'transparent', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#050505', fontWeight: 700,
      }}>{checked ? '✓' : ''}</span>
      <div>
        <div style={{ fontFamily: fInter, fontSize: 12, color: checked ? '#f0f0f0' : '#b0b0b0' }}>{label}</div>
        {sub && <div style={{ fontFamily: fMono, fontSize: 10, color: '#8a8a8a' }}>{sub}</div>}
      </div>
    </button>
  );
}

// ── SVG Icons (18px, stroke) ─────────────────────────────────────────────────

const IconGrid = ({ color }: { color: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
const IconTarget = ({ color }: { color: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
const IconPin = ({ color }: { color: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>;
const IconBuilding = ({ color }: { color: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/><path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01"/></svg>;
const IconFocus = ({ color }: { color: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>;

// ── Main Component ──────────────────────────────────────────────────────────

export function RailroadPipeline({
  campaigns, popFields, mediaList,
  selectedCampaign, selectedPopField, selectedScale, selectedMedia, selectedLayout,
  onCampaignChange, onPopFieldChange, onScaleChange, onMediaChange, onLayoutChange,
  zonesCount, totalImpressions, loading,
}: RailroadPipelineProps) {
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on click outside
  useEffect(() => {
    if (!activePopover) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setActivePopover(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activePopover]);

  const hasCampaign = !!selectedCampaign;
  const campName = campaigns.find(c => c.id === selectedCampaign)?.name ?? '—';
  const popLabel = popFields.find(f => f.value === selectedPopField)?.label ?? selectedPopField;
  const scaleLabel = selectedScale === 'cp' ? 'CP' : selectedScale === 'departement' ? 'Dept' : 'Regions';
  const mediaLabel = selectedMedia.length === 0 ? `Toutes (${mediaList.length})` : `${selectedMedia.length}/${mediaList.length}`;
  const layoutLabels: Record<string, string> = { equal: '1/3', 'focus-imp': 'Imp.', 'focus-pop': 'Pop.', 'focus-ratio': 'Ratio' };
  const layoutLabel = layoutLabels[selectedLayout] ?? '1/3';

  const allSelected = selectedMedia.length === 0;

  // Track fill states
  const t1 = hasCampaign ? 'done' : 'future';
  const t2 = hasCampaign ? 'done' : 'future';
  const t3 = hasCampaign ? 'done' : 'future';
  const t4 = hasCampaign ? 'done' : 'future';

  const toggle = (id: string) => setActivePopover(prev => prev === id ? null : id);

  return (
    <div ref={containerRef} style={{ flexShrink: 0, borderBottom: '0.5px solid #1a1a1a', background: '#050505' }}>
      {/* Railroad */}
      <div style={{ display: 'flex', alignItems: 'flex-start', padding: '16px 24px 0', gap: 0 }}>
        {/* Node 1: Campaign */}
        <div style={{ position: 'relative' }}>
          <RailNode icon={<IconGrid color={hasCampaign ? '#4ecdc4' : '#8a8a8a'} />} label="Campagne" value={hasCampaign ? campName : '—'} done={hasCampaign} active={activePopover === 'campaign'} onClick={() => toggle('campaign')} />
          <Popover open={activePopover === 'campaign'} align="left">
            {campaigns.map(c => (
              <RadioOption key={c.id} selected={selectedCampaign === c.id} label={c.name} sub={fmt(c.total_tracked_ads) + ' imp.'} onClick={() => { onCampaignChange(c.id); setActivePopover(null); }} />
            ))}
            {campaigns.length === 0 && <div style={{ padding: 12, fontFamily: fInter, fontSize: 11, color: '#8a8a8a' }}>Aucune campagne</div>}
          </Popover>
        </div>

        <Track fill={t1 as 'done' | 'current' | 'future'} />

        {/* Node 2: Target */}
        <div style={{ position: 'relative', opacity: hasCampaign ? 1 : 0.3, pointerEvents: hasCampaign ? 'auto' : 'none' }}>
          <RailNode icon={<IconTarget color={hasCampaign ? '#4ecdc4' : '#8a8a8a'} />} label="Cible" value={popLabel} done={hasCampaign} active={activePopover === 'target'} onClick={() => toggle('target')} />
          <Popover open={activePopover === 'target'}>
            {popFields.map(f => (
              <RadioOption key={f.value} selected={selectedPopField === f.value} label={f.label} onClick={() => { onPopFieldChange(f.value); setActivePopover(null); }} />
            ))}
          </Popover>
        </div>

        <Track fill={t2 as 'done' | 'current' | 'future'} />

        {/* Node 3: Geo view */}
        <div style={{ position: 'relative', opacity: hasCampaign ? 1 : 0.3, pointerEvents: hasCampaign ? 'auto' : 'none' }}>
          <RailNode icon={<IconPin color={hasCampaign ? '#4ecdc4' : '#8a8a8a'} />} label="Vue geo" value={scaleLabel} done={hasCampaign} active={activePopover === 'geo'} onClick={() => toggle('geo')} />
          <Popover open={activePopover === 'geo'}>
            {[{ id: 'region', label: 'Regions' }, { id: 'departement', label: 'Departements' }, { id: 'cp', label: 'Codes postaux' }].map(s => (
              <RadioOption key={s.id} selected={selectedScale === s.id} label={s.label} onClick={() => { onScaleChange(s.id); setActivePopover(null); }} />
            ))}
          </Popover>
        </div>

        <Track fill={t3 as 'done' | 'current' | 'future'} />

        {/* Node 4: Media */}
        <div style={{ position: 'relative', opacity: hasCampaign ? 1 : 0.3, pointerEvents: hasCampaign ? 'auto' : 'none' }}>
          <RailNode icon={<IconBuilding color={hasCampaign ? '#4ecdc4' : '#8a8a8a'} />} label="Regies" value={mediaLabel} done={hasCampaign} active={activePopover === 'media'} onClick={() => toggle('media')} />
          <Popover open={activePopover === 'media'}>
            <CheckOption checked={allSelected} label="Toutes les regies" onClick={() => onMediaChange([])} />
            <div style={{ height: '0.5px', background: '#1a1a1a', margin: '2px 0' }} />
            {mediaList.map(m => (
              <CheckOption key={m} checked={allSelected || selectedMedia.includes(m)} label={m} onClick={() => {
                if (allSelected) onMediaChange([m]);
                else if (selectedMedia.includes(m)) { const next = selectedMedia.filter(x => x !== m); onMediaChange(next); }
                else onMediaChange([...selectedMedia, m]);
              }} />
            ))}
          </Popover>
        </div>

        <Track fill={t4 as 'done' | 'current' | 'future'} />

        {/* Node 5: Focus */}
        <div style={{ position: 'relative', opacity: hasCampaign ? 1 : 0.3, pointerEvents: hasCampaign ? 'auto' : 'none' }}>
          <RailNode icon={<IconFocus color={hasCampaign ? '#4ecdc4' : '#8a8a8a'} />} label="Focus" value={layoutLabel} done={hasCampaign} active={activePopover === 'focus'} onClick={() => toggle('focus')} />
          <Popover open={activePopover === 'focus'} align="right">
            {[
              { id: 'equal', label: 'Vue 1/3 - 1/3 - 1/3', sub: 'Trois cartes egales' },
              { id: 'focus-imp', label: 'Impressions focus', sub: 'Pression media brute' },
              { id: 'focus-pop', label: 'Population focus', sub: 'Cible demographique' },
              { id: 'focus-ratio', label: 'Ratio focus', sub: 'Equilibre geo' },
            ].map(l => (
              <RadioOption key={l.id} selected={selectedLayout === l.id} label={l.label} sub={l.sub} onClick={() => { onLayoutChange(l.id); setActivePopover(null); }} />
            ))}
          </Popover>
        </div>
      </div>

      {/* Footer: stats + reset */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '8px 24px 10px', borderTop: '0.5px solid #111111', marginTop: 8 }}>
        {loading && <span style={{ fontFamily: fInter, fontSize: 11, color: '#4ecdc4' }}>Chargement...</span>}
        {!loading && hasCampaign && (
          <span style={{ fontFamily: fMono, fontSize: 12, color: '#8a8a8a' }}>
            {zonesCount.toLocaleString('fr-FR')} zones · {fmt(totalImpressions)} imp.
          </span>
        )}
      </div>

      <style>{`@keyframes rrPulse { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(1.3); opacity: 0; } }`}</style>
    </div>
  );
}
