import { describe, it, expect } from 'vitest'
import { largeurBarre } from '@/components/campagne/suivi-v2/TroisComposantes'

describe('largeur de piste', () => {
  it('rend le pourcentage tel quel dans les bornes', () => {
    expect(largeurBarre(72.5)).toBe(72.5)
    expect(largeurBarre(0)).toBe(0)
  })

  it('borne une valeur hors [0,100] plutôt que de déborder la piste', () => {
    expect(largeurBarre(-3)).toBe(0)
    expect(largeurBarre(140)).toBe(100)
  })

  it('retombe sur 0 pour une valeur absente ou non finie', () => {
    expect(largeurBarre(null)).toBe(0)
    expect(largeurBarre(undefined)).toBe(0)
    expect(largeurBarre(NaN)).toBe(0)
  })
})
