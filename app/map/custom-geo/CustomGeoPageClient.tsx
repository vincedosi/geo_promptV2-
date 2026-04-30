'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ZonesSidebar } from './_components/ZonesSidebar';
import { ZonesGrid } from './_components/ZonesGrid';
import { ZoneDetailPanel } from './_components/ZoneDetailPanel';
import { EmptyState } from './_components/EmptyState';
import { useZonesList } from './_hooks/useZonesList';
import { useZonesStats } from './_hooks/useZonesStats';
import { useZoneActions } from './_hooks/useZoneActions';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export function CustomGeoPageClient({ orgId }: { orgId: string }) {
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const { stats, loading: statsLoading, refetch: refetchStats } = useZonesStats(orgId);
  const { zones, loading, refetch } = useZonesList({
    orgId,
    sourceType: sourceTypeFilter,
    searchQuery,
  });

  const refreshAll = () => { refetch(); refetchStats(); };
  const actions = useZoneActions(refreshAll);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-primary)', fontFamily: fInter }}>
      {/* Sidebar */}
      <ZonesSidebar
        orgId={orgId}
        stats={stats}
        statsLoading={statsLoading}
        sourceTypeFilter={sourceTypeFilter}
        onSourceTypeChange={setSourceTypeFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {/* Toolbar : compteur live + bouton refresh forcé */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
            {loading ? '…' : `${zones.length} zone${zones.length !== 1 ? 's' : ''}`} en base
          </span>
          <button
            onClick={refreshAll}
            disabled={loading}
            title="Forcer le rafraîchissement"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 6, fontSize: 11, fontFamily: fInter,
              background: 'transparent', border: '0.5px solid var(--border-default)',
              color: 'var(--text-secondary)', cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Rafraîchir
          </button>
          <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
            org: {orgId.slice(0, 8)}
          </span>
        </div>

        {/* DEBUG TEMPORAIRE — à retirer une fois le problème de cache identifié */}
        <details style={{ marginBottom: 16, fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
            🔍 Debug — state zones ({zones.length} items, loading={String(loading)})
          </summary>
          <pre style={{ background: 'var(--bg-level-2)', padding: 10, borderRadius: 4, marginTop: 6, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(zones.map(z => ({ id: z.id, name: z.name, source_type: z.source_type })), null, 2)}
          </pre>
        </details>

        {!loading && zones.length === 0 ? (
          <EmptyState />
        ) : (
          <ZonesGrid
            zones={zones}
            loading={loading}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
            actions={actions}
          />
        )}
      </div>

      {/* Detail panel */}
      {selectedZoneId && (
        <ZoneDetailPanel
          zoneId={selectedZoneId}
          onClose={() => setSelectedZoneId(null)}
          actions={actions}
          onRefresh={refreshAll}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
