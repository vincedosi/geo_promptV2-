/**
 * « Ce qu'il faut corriger » — au plus trois constats CALCULÉS
 * (`calculerConstats`, `lib/campagne/constats.ts`), jamais rédigés en dur.
 * Composant purement présentationnel : ce fichier n'invente aucun texte, il
 * met en forme ce que la fonction pure a produit. Un constat qui ne
 * s'applique pas ne s'affiche pas — sur une campagne saine, `constats` est
 * `[]` et la section se réduit à sa seule mention explicative.
 */
import type { Constat } from '@/lib/campagne/constats'

/** Couleur de repère par famille — DÉRIVÉE de `id`, jamais recopiée dans les données. */
function couleurConstat(id: string): string {
  if (id === 'sous_pression') return 'var(--diverge-sous-2)'
  if (id === 'sur_pression') return 'var(--diverge-sur-2)'
  return 'var(--warning)' // canal_cher, et toute famille future non encore classée
}

function LigneConstat({ constat, rang, onAction }: {
  constat: Constat
  rang: number
  onAction?: (constat: Constat) => void
}) {
  const couleur = couleurConstat(constat.id)
  return (
    <div
      style={{
        background: 'var(--bg-level-1)', border: '0.5px solid var(--border-subtle)',
        borderRadius: 8, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 26, height: 26, borderRadius: 8, flexShrink: 0,
          display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 13,
          color: couleur, background: 'var(--bg-level-3)',
        }}
      >
        {rang}
      </span>
      <p style={{ flex: 1, margin: 0, fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.45 }}>
        {constat.titre}
      </p>
      <button
        type="button"
        onClick={() => onAction?.(constat)}
        style={{
          flexShrink: 0, border: '0.5px solid var(--border-default)', background: 'transparent',
          color: 'var(--text-secondary)', borderRadius: 6, padding: '7px 12px', fontSize: 12.5,
          cursor: 'pointer',
        }}
      >
        {constat.action}
      </button>
    </div>
  )
}

export function ConstatsCorrection({ constats, onAction }: {
  constats: Constat[]
  onAction?: (constat: Constat) => void
}) {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Ce qu&apos;il faut corriger
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
          {constats.length > 0
            ? 'Les points qui expliquent l’essentiel de l’écart.'
            : 'Aucun écart notable à ce jour — rien à corriger.'}
        </p>
      </div>

      {constats.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {constats.map((c, i) => (
            <LigneConstat key={c.id} constat={c} rang={i + 1} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  )
}
