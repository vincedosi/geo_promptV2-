'use client';

// Skeleton — créé en Task 4.7 avec nouveau contenu :
// fond de carte + sauvegarde vue + ThemeToggle + liens navigation inter-pages.

export interface SettingsOverlayProps {
  // TODO Task 4.7 : typer les props (mapStyles, currentMapStyleUrl, onMapStyleChange, etc.)
  placeholder?: boolean;
}

export function SettingsOverlay(_props: SettingsOverlayProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
      Skeleton SettingsOverlay — création en Task 4.7.
    </div>
  );
}
