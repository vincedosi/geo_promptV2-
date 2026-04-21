'use client';

// Skeleton — le JSX est migré en Task 4.4 depuis FilterPanel.tsx:1699-2229
// (POI + Panneaux OOH + Transport + TMJA + Radio + IRIS + Carreaux).

export interface TerrainOverlayProps {
  // TODO Task 4.4 : typer les ~35 props depuis FilterPanelProps
  placeholder?: boolean;
}

export function TerrainOverlay(_props: TerrainOverlayProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
      Skeleton TerrainOverlay — migration JSX en Task 4.4.
    </div>
  );
}
