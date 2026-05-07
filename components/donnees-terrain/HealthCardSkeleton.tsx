'use client';

/**
 * Skeleton loading state pour HealthIndicatorCard.
 * Reproduit le layout 2 colonnes (Air | Pollen) en placeholders shimmer.
 */
import { GeoSkeleton } from '@/components/ui/GeoSkeleton';

export function HealthCardSkeleton() {
  return (
    <div
      data-testid="civic-health-skeleton"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        padding: '12px 14px',
      }}
    >
      {[0, 1].map(i => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <GeoSkeleton width="60%" height={10} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GeoSkeleton width={20} height={20} borderRadius={10} />
            <GeoSkeleton width="50%" height={14} />
          </div>
          <GeoSkeleton width="100%" height={6} />
          <GeoSkeleton width="100%" height={6} />
          <GeoSkeleton width="100%" height={6} />
        </div>
      ))}
    </div>
  );
}
