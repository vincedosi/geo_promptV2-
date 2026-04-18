'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';

interface LayerSwitchProps {
  name: string;
  icon?: ReactNode;
  badge?: string;
  color?: string;
  active: boolean;
  onToggle: () => void;
  expanded?: boolean;
  onExpand?: () => void;
  children?: ReactNode;
}

export function LayerSwitch({
  name,
  icon,
  badge,
  color = 'var(--brand-teal)',
  active,
  onToggle,
  expanded,
  onExpand,
  children,
}: LayerSwitchProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded !== undefined ? expanded : localExpanded;
  const toggleExpand = onExpand ?? (() => setLocalExpanded(prev => !prev));

  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(isExpanded ? undefined : 0);

  useEffect(() => {
    if (!contentRef.current || !children) return;
    if (isExpanded) {
      setHeight(contentRef.current.scrollHeight);
      const timer = setTimeout(() => setHeight(undefined), 200);
      return () => clearTimeout(timer);
    } else {
      setHeight(contentRef.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
  }, [isExpanded, children]);

  return (
    <div style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
      {/* Compact row — 36px */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        minHeight: 36,
      }}>
        {/* Dot indicator */}
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: color,
          opacity: active ? 1 : 0.3,
          flexShrink: 0,
          transition: 'opacity 0.2s ease',
        }} />

        {/* Icon (optional) */}
        {icon && (
          <span style={{ display: 'inline-flex', color: 'var(--text-tertiary)', flexShrink: 0 }}>
            {icon}
          </span>
        )}

        {/* Name — clickable to expand */}
        <span
          onClick={children ? toggleExpand : undefined}
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 400,
            fontSize: 13,
            color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            flex: 1,
            cursor: children ? 'pointer' : 'default',
            transition: 'color 0.15s ease',
          }}
        >
          {name}
        </span>

        {/* Badge (optional) */}
        {badge && (
          <span style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 10,
            color: 'var(--text-tertiary)',
            background: 'var(--bg-level-3, #181818)',
            border: '0.5px solid var(--border-default)',
            borderRadius: 4,
            padding: '2px 8px',
            flexShrink: 0,
          }}>
            {badge}
          </span>
        )}

        {/* Switch toggle */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggle(); }}
          aria-label={`${active ? 'Masquer' : 'Afficher'} ${name}`}
          style={{
            width: 32, height: 18,
            borderRadius: 9,
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            flexShrink: 0,
            position: 'relative',
            background: active ? color : 'var(--border-subtle)',
            transition: 'background 0.2s ease',
          }}
        >
          <span style={{
            position: 'absolute',
            top: 2, left: active ? 16 : 2,
            width: 14, height: 14,
            borderRadius: '50%',
            background: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            transition: 'left 0.2s ease, background 0.2s ease',
          }} />
        </button>
      </div>

      {/* Expandable settings accordion */}
      {children && (
        <div
          ref={contentRef}
          style={{
            overflow: 'hidden',
            transition: 'height 0.2s ease',
            height,
          }}
        >
          <div style={{
            padding: '8px 14px 12px 32px',
            borderLeft: '2px solid var(--border-subtle)',
            marginLeft: 20,
          }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
