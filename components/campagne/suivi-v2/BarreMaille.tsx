'use client'
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext'
import { MAILLES, type Maille } from '@/lib/campagne/session-types'
import { formaterNombre } from '@/lib/format/nombre'

export const LIBELLES_MAILLE: Record<Maille, string> = {
  region: 'Région', departement: 'Département', cp: 'Code postal',
}

/** Logique pure, testée sans DOM. */
export function libelleFilAriane(_maille: Maille, parent: string | null, nomParent: string | null): string[] {
  const fil = ['France entière']
  if (parent) fil.push(nomParent ?? parent)
  return fil
}

export function BarreMaille({ nUnites, nTotal, nomParent }: {
  nUnites: number; nTotal: number; nomParent: string | null
}) {
  const { session, majSession } = useCampagneSession()
  const fil = libelleFilAriane(session.maille, session.parent, nomParent)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '10px 14px',
      background: 'var(--bg-level-2)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <nav aria-label="Fil d'Ariane" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {fil.map((seg, i) => (
          <span key={seg} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}>›</span>}
            {i < fil.length - 1 ? (
              <button
                onClick={() => majSession({ parent: null, uniteSelectionnee: null })}
                style={{
                  border: 0, background: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--brand-teal)', fontSize: 13, textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >{seg}</button>
            ) : (
              <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{seg}</span>
            )}
          </span>
        ))}
      </nav>

      <div role="group" aria-label="Maille d'affichage" style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        {MAILLES.map(m => (
          <button
            key={m}
            aria-pressed={session.maille === m}
            onClick={() => majSession({ maille: m })}
            style={{
              border: '0.5px solid ' + (session.maille === m ? 'var(--brand-teal)' : 'var(--border-default)'),
              background: session.maille === m ? 'var(--brand-teal-10)' : 'transparent',
              color: session.maille === m ? 'var(--brand-teal)' : 'var(--text-secondary)',
              borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >{LIBELLES_MAILLE[m]}</button>
        ))}
        <span style={{
          marginLeft: 8, alignSelf: 'center', fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-tertiary)',
        }}>
          {nUnites < nTotal
            ? `${formaterNombre(nUnites)} sur ${formaterNombre(nTotal)}, les plus déréglées`
            : `${formaterNombre(nTotal)} unités`}
        </span>
      </div>
    </div>
  )
}
