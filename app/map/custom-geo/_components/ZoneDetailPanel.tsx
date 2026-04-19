'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { X } from 'lucide-react';
import { useZoneDetail } from '../_hooks/useZoneDetail';
import { ZoneRenameDialog } from './ZoneRenameDialog';
import { ZoneDeleteDialog } from './ZoneDeleteDialog';
import type { CustomGeoExportFormat } from '@/types/custom-geo';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  zoneId: string;
  onClose: () => void;
  actions: {
    rename: (id: string, name: string, desc?: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    exportZone: (id: string, format: CustomGeoExportFormat) => void;
  };
  onRefresh: () => void;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ZoneDetailPanel({ zoneId, onClose, actions, onRefresh }: Props) {
  const router = useRouter();
  const { zone, loading } = useZoneDetail(zoneId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (loading || !zone) {
    return (
      <div style={{ width: 480, flexShrink: 0, borderLeft: '0.5px solid var(--border-subtle)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
        Chargement...
      </div>
    );
  }

  return (
    <div style={{ width: 480, flexShrink: 0, borderLeft: '0.5px solid var(--border-subtle)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: fInter }}>{zone.name}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      {/* Map placeholder */}
      <div style={{ height: 240, background: 'var(--bg-level-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fMono }}>
        Carte interactive
      </div>

      {/* Details */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {[
              ['Source', zone.source_type, true],
              ['IRIS', zone.feature_count_iris.toLocaleString('fr-FR'), false],
              ['Codes postaux', String(zone.feature_count_cp), false],
              ['Cree le', fmtDate(zone.created_at), false],
            ].map(([label, value, mono]) => (
              <tr key={label as string}>
                <td style={{ padding: '6px 0', color: 'var(--text-tertiary)', fontFamily: fInter }}>{label as string}</td>
                <td style={{ padding: '6px 0', color: 'var(--text-primary)', fontFamily: mono ? fMono : fInter, textAlign: 'right' }}>{value as string}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Metadata */}
        {Object.keys(zone.source_metadata).length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Metadonnees source
            </div>
            <pre style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-level-2)', padding: 10, borderRadius: 4, overflow: 'auto', maxHeight: 120 }}>
              {JSON.stringify(zone.source_metadata, null, 2)}
            </pre>
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => setRenameOpen(true)} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, fontFamily: fInter, background: 'transparent', border: '0.5px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer', width: '100%' }}>
            Renommer
          </button>

          <div style={{ display: 'flex', gap: 6 }}>
            {(['csv_cp', 'csv_iris', 'geojson'] as const).map(fmt => (
              <button key={fmt} onClick={() => actions.exportZone(zoneId, fmt)} style={{ flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 10, fontFamily: fMono, background: 'transparent', border: '0.5px solid var(--border-default)', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                {fmt}
              </button>
            ))}
          </div>

          <button
            onClick={() => router.push(`/map/analyse/digital?customZone=${zoneId}`)}
            style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, fontFamily: fInter, background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)', cursor: 'pointer', width: '100%' }}
          >
            Utiliser dans Digital
          </button>

          <button onClick={() => setDeleteOpen(true)} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, fontFamily: fInter, background: 'rgba(255,87,87,0.05)', border: '0.5px solid rgba(255,87,87,0.2)', color: 'var(--danger)', cursor: 'pointer', width: '100%', marginTop: 8 }}>
            Supprimer
          </button>
        </div>
      </div>

      {renameOpen && (
        <ZoneRenameDialog
          zoneId={zoneId}
          currentName={zone.name}
          currentDescription={zone.description ?? ''}
          onRename={async (name, desc) => { await actions.rename(zoneId, name, desc); onRefresh(); setRenameOpen(false); }}
          onClose={() => setRenameOpen(false)}
        />
      )}

      {deleteOpen && (
        <ZoneDeleteDialog
          zoneName={zone.name}
          onConfirm={async () => { await actions.remove(zoneId); onClose(); onRefresh(); }}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}
