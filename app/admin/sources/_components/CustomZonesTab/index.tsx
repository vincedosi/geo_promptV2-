'use client';

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useAdminCustomZones, type AdminCustomZone } from '../../_hooks/useAdminCustomZones';
import { WorkspaceFilter } from './WorkspaceFilter';
import { SourceTypeFilter } from './SourceTypeFilter';
import { ZonesTable } from './ZonesTable';
import { ZoneAdminDeleteDialog } from './ZoneAdminDeleteDialog';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

export function CustomZonesTab() {
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminCustomZone | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { zones, loading, error, refetch, remove } = useAdminCustomZones({
    orgId: orgFilter,
    sourceType: sourceTypeFilter,
    searchQuery,
  });

  // Listes dynamiques pour les filtres (dérivées du jeu courant ; pas d'enum hardcodé)
  const sourceTypes = useMemo(() => {
    const set = new Set<string>();
    zones.forEach(z => set.add(z.source_type));
    return Array.from(set).sort();
  }, [zones]);

  const hasActiveFilters = !!(orgFilter || sourceTypeFilter || searchQuery);
  const totalIris = zones.reduce((sum, z) => sum + z.feature_count_iris, 0);
  const totalCp = zones.reduce((sum, z) => sum + z.feature_count_cp, 0);
  const nbWorkspaces = new Set(zones.map(z => z.org_id)).size;

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await remove(deleteTarget.id);
      setDeleteTarget(null);
      void refetch();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Suppression échouée');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Zones perso — {zones.length} zone{zones.length > 1 ? 's' : ''} sur {nbWorkspaces} workspace{nbWorkspaces > 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <WorkspaceFilter value={orgFilter} onChange={setOrgFilter} />
          <SourceTypeFilter sourceTypes={sourceTypes} value={sourceTypeFilter} onChange={setSourceTypeFilter} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 4,
            padding: '6px 10px',
            minWidth: 200,
          }}>
            <Search size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontFamily: fInter, fontSize: 12,
              }}
            />
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(255,87,87,0.1)',
          border: '0.5px solid rgba(255,87,87,0.2)',
          borderRadius: 4,
          color: 'var(--danger)',
          fontFamily: fInter, fontSize: 11,
        }}>
          Erreur : {error}
        </div>
      )}

      {/* Table */}
      <ZonesTable
        zones={zones}
        loading={loading}
        hasActiveFilters={hasActiveFilters}
        onDelete={setDeleteTarget}
      />

      {/* Footer stats */}
      {zones.length > 0 && (
        <div style={{
          fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)',
          textAlign: 'center', paddingTop: 4,
        }}>
          {hasActiveFilters ? 'Filtres actifs : ' : ''}
          {zones.length} zone{zones.length > 1 ? 's' : ''} — {totalIris.toLocaleString('fr-FR')} IRIS — {totalCp.toLocaleString('fr-FR')} CP résolus
        </div>
      )}

      {/* Delete dialog */}
      {deleteTarget && (
        <ZoneAdminDeleteDialog
          zone={deleteTarget}
          onConfirm={handleConfirmDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
          deleting={deleting}
        />
      )}

      {/* Delete error (toast-style) */}
      {deleteError && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 1001,
          padding: '10px 14px',
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--danger)',
          borderRadius: 4,
          color: 'var(--danger)',
          fontFamily: fInter, fontSize: 12,
        }}>
          {deleteError}
        </div>
      )}
    </div>
  );
}
