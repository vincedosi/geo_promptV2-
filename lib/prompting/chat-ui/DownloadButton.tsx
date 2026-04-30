'use client';

/**
 * Pattern 5 — Bouton de téléchargement d'un blob texte.
 * Utilisé pour exporter les codes générés (DV360 / Adform / TTD).
 */
const fInter = "'Inter', system-ui, sans-serif";

export interface DownloadButtonProps {
  text: string;
  filename: string;
  label?: string;
  mimeType?: string;
}

export function DownloadButton({ text, filename, label = 'Télécharger', mimeType = 'text/plain' }: DownloadButtonProps) {
  const trigger = () => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={trigger}
      style={{
        padding: '4px 10px', fontFamily: fInter, fontSize: 10, cursor: 'pointer',
        background: 'transparent', border: '0.5px solid rgba(255,255,255,0.12)',
        borderRadius: 4, color: 'var(--text-secondary)',
      }}
    >{label}</button>
  );
}
