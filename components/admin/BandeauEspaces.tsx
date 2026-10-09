/**
 * Bandeau de renvoi affiché en tête des pages d'administration React gelées
 * (utilisateurs, organisations). Les droits se gèrent dans l'interface Angular.
 * Jetons du design system uniquement : lisible dans les deux thèmes.
 */
export function BandeauEspaces() {
  return (
    <div
      role="note"
      style={{
        background: 'var(--bg-level-2)',
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 6,
        color: 'var(--text-secondary)',
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
        padding: '10px 14px',
        marginBottom: 20,
      }}
    >
      Les droits se gèrent désormais dans{' '}
      <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Espaces de travail</strong>{' '}
      (interface Angular, Administration › Espaces de travail). Cette page reste disponible en lecture.
    </div>
  )
}
