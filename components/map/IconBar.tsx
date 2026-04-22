'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, MapPin, Layers, BarChart3, Megaphone, Settings, Home } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type OverlayId = 'ai' | 'perimeter' | 'terrain' | 'analyses' | 'campaigns' | 'settings';

interface IconBarItem {
  id: OverlayId | 'home';
  label: string;
  icon: LucideIcon;
  colorVar: string;
  rgb: string;
  position?: 'top' | 'bottom';
  separator?: boolean;
}

const ICON_BAR_ITEMS: IconBarItem[] = [
  { id: 'home', label: 'Home', icon: Home, colorVar: 'var(--text-tertiary)', rgb: '102,102,102' },
  { id: 'ai', label: 'geo.prompt', icon: Bot, colorVar: 'var(--brand-teal)', rgb: '78,205,196', separator: true },
  { id: 'perimeter', label: 'Périmètre', icon: MapPin, colorVar: 'var(--cat-context, #8a8a8a)', rgb: '138,138,138' },
  { id: 'terrain', label: 'Terrain', icon: Layers, colorVar: 'var(--cat-terrain, #4ecdc4)', rgb: '78,205,196' },
  { id: 'analyses', label: 'Analyses', icon: BarChart3, colorVar: 'var(--cat-analysis, #e8845c)', rgb: '232,132,92' },
  { id: 'campaigns', label: 'Campagnes', icon: Megaphone, colorVar: 'var(--cat-media, #f7b731)', rgb: '247,183,49' },
  { id: 'settings', label: 'Réglages', icon: Settings, colorVar: 'var(--text-tertiary)', rgb: '102,102,102', position: 'bottom' },
];

interface IconBarProps {
  activeItem: OverlayId | null;
  onItemClick: (id: OverlayId) => void;
  hidden?: boolean;
  studyAvailable?: boolean;
  showLabels?: boolean;
}

export function IconBar({
  activeItem,
  onItemClick,
  hidden = false,
  studyAvailable = false,
  showLabels = true,
}: IconBarProps) {
  const router = useRouter();

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
      {topItems.map(item => (
        <IconButton
          key={item.id}
          item={item}
          active={activeItem === item.id}
          showLabel={showLabels}
          studyBadge={item.id === 'analyses' && studyAvailable}
          onClick={() => {
            if (item.id === 'home') {
              router.push('/dashboard');
              return;
            }
            onItemClick(item.id as OverlayId);
          }}
        />
      ))}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        {bottomItems.map(item => (
          <IconButton
            key={item.id}
            item={item}
            active={activeItem === item.id}
            showLabel={showLabels}
            onClick={() => onItemClick(item.id as OverlayId)}
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
  studyBadge?: boolean;
  onClick: () => void;
}

function IconButton({ item, active, showLabel, studyBadge, onClick }: IconButtonProps) {
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
        {/* Badge Étude disponible sur Analyses */}
        {studyBadge && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 6,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--brand-teal, #4ecdc4)',
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
