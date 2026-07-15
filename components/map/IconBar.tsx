'use client';

import { useEffect } from 'react';
import { Bot, MapPin, Layers, Users, BarChart3, Target, Settings, Bookmark } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMagelianOverlay } from '@/components/magelian/MagelianOverlayContext';

export type OverlayId = 'ai' | 'perimeter' | 'terrain' | 'audience' | 'analyses' | 'pilotage' | 'zones' | 'settings';

interface IconBarItem {
  id: OverlayId;
  label: string;
  icon: LucideIcon;
  colorVar: string;
  rgb: string;
  position?: 'top' | 'bottom';
  separator?: boolean;
}

// Ordre = workflow : où → quoi (physique) → qui (audience) → calculs → média.
const ICON_BAR_ITEMS: IconBarItem[] = [
  { id: 'ai', label: 'geo.prompt', icon: Bot, colorVar: 'var(--brand-teal)', rgb: '78,205,196' },
  { id: 'perimeter', label: 'Périmètre', icon: MapPin, colorVar: 'var(--cat-context, #8a8a8a)', rgb: '138,138,138', separator: true },
  { id: 'terrain', label: 'Terrain', icon: Layers, colorVar: 'var(--cat-terrain, #4ecdc4)', rgb: '78,205,196' },
  { id: 'audience', label: 'Audience', icon: Users, colorVar: 'var(--cat-socio, #5b9bd5)', rgb: '91,155,213' },
  { id: 'analyses', label: 'Analyses', icon: BarChart3, colorVar: 'var(--cat-analysis, #e8845c)', rgb: '232,132,92' },
  { id: 'pilotage', label: 'Pilotage ML', icon: Target, colorVar: 'var(--brand-teal)', rgb: '78,205,196' },
  { id: 'zones', label: 'Zones', icon: Bookmark, colorVar: 'var(--brand-teal, #4ecdc4)', rgb: '78,205,196' },
  { id: 'settings', label: 'Réglages', icon: Settings, colorVar: 'var(--text-tertiary)', rgb: '102,102,102', position: 'bottom' },
];

interface IconBarProps {
  activeItem: OverlayId | null;
  onItemClick: (id: OverlayId) => void;
  hidden?: boolean;
  showLabels?: boolean;
}

export function IconBar({
  activeItem,
  onItemClick,
  hidden = false,
  showLabels = true,
}: IconBarProps) {
  // Shortcut "/" ouvre AI overlay (si focus pas dans input)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) {
        return;
      }
      e.preventDefault();
      onItemClick('ai');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onItemClick]);

  const { openOverlay } = useMagelianOverlay();
  const topItems = ICON_BAR_ITEMS.filter(i => i.position !== 'bottom');
  const bottomItems = ICON_BAR_ITEMS.filter(i => i.position === 'bottom');

  return (
    <aside
      className="icon-bar"
      data-hidden={hidden ? 'true' : 'false'}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 48,
        background: 'var(--bg-surface)',
        borderRight: '0.5px solid var(--border-subtle, #1a1a1a)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 4,
        transform: hidden ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 200ms var(--ease-out, ease)',
      }}
    >
      {/* Bouton MAGELIAN — tuile de marque (teal plein + hexagone sombre, comme
          le bouton send du design system), ouvre l'overlay campagne. */}
      <button
        type="button"
        data-magelian-trigger
        onClick={() => openOverlay()}
        title="MAGELIAN — cockpit campagne"
        aria-label="MAGELIAN — cockpit campagne"
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--brand-teal)',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--bg-primary)',
          transition: 'background-color 150ms var(--ease-hover, ease)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-teal-hover)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand-teal)'; }}
      >
        {/* Hexagone MAGELIAN — même motif que le logo */}
        <svg width="19" height="19" viewBox="0 0 28 28" fill="none" aria-hidden>
          <path d="M14 2L25.5 8.5V19.5L14 26L2.5 19.5V8.5L14 2Z" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="14" cy="14" r="2.5" fill="currentColor" />
        </svg>
      </button>
      <div style={{ width: 24, height: 0.5, background: 'var(--border-subtle, #1a1a1a)', margin: '4px 0' }} />

      {topItems.map(item => (
        <IconButton
          key={item.id}
          item={item}
          active={activeItem === item.id}
          showLabel={showLabels}
          onClick={() => onItemClick(item.id)}
        />
      ))}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        {bottomItems.map(item => (
          <IconButton
            key={item.id}
            item={item}
            active={activeItem === item.id}
            showLabel={showLabels}
            onClick={() => onItemClick(item.id)}
          />
        ))}
      </div>
    </aside>
  );
}

interface IconButtonProps {
  item: IconBarItem;
  active: boolean;
  showLabel: boolean;
  onClick: () => void;
}

function IconButton({ item, active, showLabel, onClick }: IconButtonProps) {
  const Icon = item.icon;
  const isAI = item.id === 'ai';

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={item.label}
        aria-pressed={active}
        style={{
          width: 40,
          height: showLabel ? 44 : 40,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          background: active ? `rgba(${item.rgb}, 0.08)` : 'transparent',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background-color 150ms var(--ease-hover, ease), color 150ms var(--ease-hover, ease)',
          color: active || isAI ? item.colorVar : 'var(--text-tertiary, #666666)',
        }}
        onMouseEnter={e => {
          if (!active) e.currentTarget.style.background = 'var(--bg-level-2)';
        }}
        onMouseLeave={e => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Indicateur actif vertical à gauche */}
        {active && (
          <span
            style={{
              position: 'absolute',
              left: -4,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: '0 2px 2px 0',
              background: item.colorVar,
            }}
          />
        )}
        {/* Pulse dot pour AI */}
        {isAI && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 6,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--brand-teal, #4ecdc4)',
              boxShadow: '0 0 0 0 rgba(78,205,196,0.6)',
              animation: 'iconBarPulse 2s ease-in-out infinite',
            }}
          />
        )}
        <Icon size={20} strokeWidth={1.5} />
        {showLabel && (
          <span
            style={{
              fontSize: 9,
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 500,
              letterSpacing: '0.01em',
              lineHeight: 1,
              color: 'inherit',
            }}
          >
            {item.label.length > 8 ? item.label.slice(0, 8) : item.label}
          </span>
        )}
      </button>
      {item.separator && (
        <div
          style={{
            width: 24,
            height: 0.5,
            background: 'var(--border-subtle, #1a1a1a)',
            margin: '4px 0',
          }}
        />
      )}
      <style jsx global>{`
        @keyframes iconBarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(78,205,196,0.6); }
          50% { box-shadow: 0 0 0 4px rgba(78,205,196,0); }
        }
      `}</style>
    </>
  );
}
