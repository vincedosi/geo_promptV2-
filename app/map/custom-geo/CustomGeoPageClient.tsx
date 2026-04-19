'use client';

import { useState } from 'react';
import { ZonesSidebar } from './_components/ZonesSidebar';
import { ZonesGrid } from './_components/ZonesGrid';
import { ZoneDetailPanel } from './_components/ZoneDetailPanel';
import { EmptyState } from './_components/EmptyState';
import { useZonesList } from './_hooks/useZonesList';
import { useZonesStats } from './_hooks/useZonesStats';
import { useZoneActions } from './_hooks/useZoneActions';

const fInter = "'Inter', system-ui, sans-serif";

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
    </div>
  );
}
