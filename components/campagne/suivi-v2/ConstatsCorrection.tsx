/**
 * « Ce qu'il faut corriger » — au plus trois constats CALCULÉS
 * (`calculerConstats`, `lib/campagne/constats.ts`), jamais rédigés en dur.
 * Composant purement présentationnel : ce fichier n'invente aucun texte, il
 * met en forme ce que la fonction pure a produit. Un constat qui ne
 * s'applique pas ne s'affiche pas — sur une campagne saine, `constats` est
 * `[]` et la section se réduit à sa seule mention explicative.
 *
 * `etat` n'est PAS optionnel, et « rien à corriger » n'est dit que sous
 * `'pret'` : une liste vide seule ne distingue pas « pas encore chargé » de
 * « la requête a échoué » et de « rien à signaler », et cette section est
 * précisément celle dont le métier est d'alerter (constat 15, voir
 * `etat-section.ts`).
 */
import type { Constat } from '@/lib/campagne/constats'
import type { EtatSection } from './etat-section'

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

/** Sous-titre de la section — un texte par état, jamais un `[]` pour trois sens. */
function sousTitre(etat: EtatSection, nConstats: number): string {
  if (etat === 'chargement') return 'Analyse des écarts en cours…'
  if (etat === 'echec') return 'Analyse des écarts indisponible — rien ne dit que la campagne est alignée.'
  return nConstats > 0
    ? 'Les points qui expliquent l’essentiel de l’écart.'
    : 'Aucun écart notable à ce jour — rien à corriger.'
}

export function ConstatsCorrection({ constats, etat, onAction, onReessayer }: {
  constats: Constat[]
  /** Obligatoire : voir l'en-tête de fichier et `etat-section.ts`. */
  etat: EtatSection
  onAction?: (constat: Constat) => void
  onReessayer?: () => void
}) {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Ce qu&apos;il faut corriger
        </h2>
        <p style={{
          margin: '4px 0 0', fontSize: 13,
          color: etat === 'echec' ? 'var(--danger)' : 'var(--text-tertiary)',
        }}>
          {sousTitre(etat, constats.length)}
        </p>
      </div>

      {/* L'échec est ANNONCÉ, jamais avalé : sur l'écran qui doit alerter, un
          silence se lit comme une bonne nouvelle. */}
      {etat === 'echec' && (
        <div
          role="alert"
          style={{
            background: 'var(--bg-level-1)', border: '0.5px solid var(--border-subtle)',
            borderRadius: 8, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16,
          }}
        >
          <p style={{ flex: 1, margin: 0, fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.45 }}>
            Le calcul des constats n’a pas abouti. Les écarts de cette campagne n’ont pas été vérifiés.
          </p>
          {onReessayer && (
            <button
              type="button"
              onClick={onReessayer}
              style={{
                flexShrink: 0, border: '0.5px solid var(--brand-teal)', background: 'transparent',
                color: 'var(--brand-teal)', borderRadius: 6, padding: '7px 12px', fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              Réessayer
            </button>
          )}
        </div>
      )}

      {etat === 'pret' && constats.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {constats.map((c, i) => (
            <LigneConstat key={c.id} constat={c} rang={i + 1} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  )
}
