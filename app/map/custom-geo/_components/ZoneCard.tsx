'use client';

import { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { CustomGeoZoneSummary, CustomGeoExportFormat } from '@/types/custom-geo';
import { ZoneActionsMenu } from './ZoneActionsMenu';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  zone: CustomGeoZoneSummary;
  selected: boolean;
  onSelect: () => void;
  actions: {
    rename: (id: string, name: string, desc?: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    exportZone: (id: string, format: CustomGeoExportFormat) => void;
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export function ZoneCard({ zone, selected, onSelect, actions }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onClick={onSelect}
      style={{
        background: 'var(--bg-surface)',
        border: `0.5px solid ${selected ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
        borderRadius: 8, cursor: 'pointer', overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(78,205,196,0.3)'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'; }}
    >
      {/* Map preview placeholder */}
      <div style={{
        height: 140, background: 'var(--bg-level-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: 'var(--text-tertiary)', fontFamily: fMono,
      }}>
        {zone.bbox ? `${zone.bbox[0]?.toFixed(1)}, ${zone.bbox[1]?.toFixed(1)}` : 'Preview'}
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: fInter, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {zone.name}
          </span>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 2 }}
          >
            <MoreVertical size={14} />
          </button>
        </div>

        <div style={{ fontSize: 10, fontFamily: fMono, color: 'var(--brand-teal)', marginBottom: 8 }}>
          {zone.source_type}
        </div>

        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-tertiary)' }}>
          <span><strong style={{ fontFamily: fMono }}>{zone.feature_count_iris.toLocaleString('fr-FR')}</strong> IRIS</span>
          <span><strong style={{ fontFamily: fMono }}>{zone.feature_count_cp}</strong> CP</span>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
          {fmtDate(zone.created_at)}
        </div>
      </div>

      {menuOpen && (
        <ZoneActionsMenu
          zoneId={zone.id}
          zoneName={zone.name}
          actions={actions}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
