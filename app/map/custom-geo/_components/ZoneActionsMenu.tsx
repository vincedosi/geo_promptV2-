'use client';

import { useEffect, useRef } from 'react';
import type { CustomGeoExportFormat } from '@/types/custom-geo';

const fInter = "'Inter', system-ui, sans-serif";

interface Props {
  zoneId: string;
  zoneName: string;
  actions: {
    rename: (id: string, name: string, desc?: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    exportZone: (id: string, format: CustomGeoExportFormat) => void;
  };
  onClose: () => void;
}

const menuItems = [
  { label: 'Exporter CSV CP', action: 'csv_cp' },
  { label: 'Exporter CSV IRIS', action: 'csv_iris' },
  { label: 'Exporter GeoJSON', action: 'geojson' },
  { label: 'Supprimer', action: 'delete', danger: true },
] as const;

export function ZoneActionsMenu({ zoneId, actions, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleClick = async (action: string) => {
    if (action === 'delete') {
      if (confirm('Supprimer cette zone ? Cette action est irreversible.')) {
        await actions.remove(zoneId);
      }
    } else {
      actions.exportZone(zoneId, action as CustomGeoExportFormat);
    }
    onClose();
  };

  return (
    <div ref={ref} style={{
      position: 'absolute', right: 8, top: 8, zIndex: 20,
      background: 'var(--bg-level-2)', border: '0.5px solid var(--border-default)',
      borderRadius: 6, overflow: 'hidden', minWidth: 160,
    }}>
      {menuItems.map(item => (
        <button
          key={item.action}
          onClick={e => { e.stopPropagation(); handleClick(item.action); }}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '8px 12px', border: 'none', cursor: 'pointer',
            fontFamily: fInter, fontSize: 12,
            background: 'transparent',
            color: item.danger ? 'var(--danger)' : 'var(--text-secondary)',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-3, #181818)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
