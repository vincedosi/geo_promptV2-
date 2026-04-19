'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface CategoryGroupProps {
  title: string;
  color?: string;
  colorRgb?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}

const STORAGE_PREFIX = 'geomatik-cat-';

export function CategoryGroup({
  title,
  color = 'var(--brand-teal)',
  colorRgb = '78, 205, 196',
  defaultOpen = true,
  collapsible = true,
  children,
}: CategoryGroupProps) {
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    if (typeof window === 'undefined') return defaultOpen;
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${title}`);
    return stored !== null ? stored === '1' : defaultOpen;
  });

  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!collapsible) return;
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${title}`, open ? '1' : '0');
    } catch { /* SSR / iframe */ }
  }, [open, title, collapsible]);

  useEffect(() => {
    if (!contentRef.current) return;
    if (open) {
      setHeight(contentRef.current.scrollHeight);
      const timer = setTimeout(() => setHeight(undefined), 200);
      return () => clearTimeout(timer);
    } else {
      setHeight(contentRef.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
  }, [open]);

  const toggle = () => {
    if (collapsible) setOpen(prev => !prev);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Header bandeau — fond teinté par la couleur catégorie */}
      <div
        onClick={toggle}
        style={{
          background: `rgba(${colorRgb}, 0.06)`,
          borderTop: `1px solid rgba(${colorRgb}, 0.12)`,
          borderBottom: `1px solid rgba(${colorRgb}, 0.08)`,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
          transition: 'background-color 150ms var(--ease-hover)',
        }}
        onMouseEnter={collapsible ? e => { e.currentTarget.style.background = `rgba(${colorRgb}, 0.10)`; } : undefined}
        onMouseLeave={collapsible ? e => { e.currentTarget.style.background = `rgba(${colorRgb}, 0.06)`; } : undefined}
      >
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color, flexShrink: 0,
        }} />
        <span style={{
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 600,
          fontSize: 11,
          color: color,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          flex: 1,
        }}>
          {title}
        </span>
        {collapsible && (
          <ChevronDown size={14} style={{
            color: color,
            opacity: 0.5,
            flexShrink: 0,
            transition: 'transform 200ms var(--ease-out)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }} />
        )}
      </div>

      {/* Collapsible body */}
      <div
        ref={contentRef}
        style={{
          overflow: 'hidden',
          transition: 'height 240ms cubic-bezier(0.32, 0.72, 0, 1)',
          height: !collapsible ? undefined : height,
        }}
      >
        {children}
      </div>
    </div>
  );
}
