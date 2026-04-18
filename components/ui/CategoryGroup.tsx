'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface CategoryGroupProps {
  title: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}

const STORAGE_PREFIX = 'geomatik-cat-';

export function CategoryGroup({
  title,
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
    <div>
      {/* Header bandeau */}
      <div
        onClick={toggle}
        style={{
          background: 'var(--bg-level-2)',
          borderTop: '1px solid var(--border-subtle)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--brand-teal)', flexShrink: 0,
        }} />
        <span style={{
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: 11,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          flex: 1,
        }}>
          {title}
        </span>
        {collapsible && (
          <ChevronDown size={14} style={{
            color: 'var(--text-tertiary)',
            flexShrink: 0,
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }} />
        )}
      </div>

      {/* Collapsible body */}
      <div
        ref={contentRef}
        style={{
          overflow: 'hidden',
          transition: 'height 0.2s ease',
          height: !collapsible ? undefined : height,
        }}
      >
        {children}
      </div>
    </div>
  );
}
