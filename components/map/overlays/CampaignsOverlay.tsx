'use client';

// Skeleton — le JSX est migré en Task 4.6 depuis FilterPanel.tsx:3245-3408 (Digital).
// Le toggle Vue comparée/fusionnée et TripleMapView restent dans page.tsx (statu quo Q3).

export interface CampaignsOverlayProps {
  // TODO Task 4.6 : typer les props digital depuis FilterPanelProps
  placeholder?: boolean;
}

export function CampaignsOverlay(_props: CampaignsOverlayProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
      Skeleton CampaignsOverlay — migration JSX en Task 4.6.
    </div>
  );
}
