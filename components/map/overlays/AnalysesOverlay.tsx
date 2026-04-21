'use client';

// Skeleton — le JSX est migré en Task 4.5 depuis FilterPanel.tsx:2234-3240
// (Voronoï + Battle + Isochrone + Scoring + Correlation + Clustering + Couverture).
// CTA "Ouvrir l'étude de ville →" ajouté conditionnellement dans la section Scoring.

export interface AnalysesOverlayProps {
  // TODO Task 4.5 : typer les props depuis FilterPanelProps
  studyVille?: string | null;
  onOpenStudy?: () => void;
}

export function AnalysesOverlay(_props: AnalysesOverlayProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
      Skeleton AnalysesOverlay — migration JSX en Task 4.5.
    </div>
  );
}
