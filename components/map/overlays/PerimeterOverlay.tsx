'use client';

// Skeleton — le JSX est migré en Task 4.3 depuis FilterPanel.tsx:1550-1694.
// Les props seront typées précisément lors de la migration.

export interface PerimeterOverlayProps {
  // TODO Task 4.3 : typer les props depuis FilterPanelProps
  placeholder?: boolean;
}

export function PerimeterOverlay(_props: PerimeterOverlayProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
      Skeleton PerimeterOverlay — migration JSX en Task 4.3.
    </div>
  );
}
