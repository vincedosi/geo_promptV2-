import { describe, it, expect } from 'vitest'
import { volumeCibleTotal, pourcentageVolumeLivre } from '@/lib/campagne/avancement'

describe('volumeCibleTotal', () => {
  it('remonte la cible totale depuis la cible proratisée au temps écoulé', () => {
    // expected = cible_totale * time_pct/100 => cible_totale = expected / (time_pct/100)
    expect(volumeCibleTotal({ realized: 0, expected: 4830000, pct: null }, 49.2)).toBeCloseTo(9817073.17, 1)
  })

  it('rend null sans temps écoulé positif', () => {
    expect(volumeCibleTotal({ realized: 0, expected: 1000, pct: null }, 0)).toBeNull()
    expect(volumeCibleTotal({ realized: 0, expected: 1000, pct: null }, null)).toBeNull()
  })

  it('rend null sans cible proratisée', () => {
    expect(volumeCibleTotal({ realized: 0, expected: null, pct: null }, 49.2)).toBeNull()
  })
})

describe('pourcentageVolumeLivre', () => {
  it('rapporte le réalisé à la cible totale, pas à la cible proratisée', () => {
    // cible_totale ≈ 9 817 073 ; réalisé 3 940 000 => ≈ 40,1 %
    const pct = pourcentageVolumeLivre({ realized: 3940000, expected: 4830000, pct: 81.6 }, 49.2)
    expect(pct).toBeCloseTo(40.1, 1)
  })

  it('rend null quand la cible totale est indéterminée', () => {
    expect(pourcentageVolumeLivre({ realized: 100, expected: null, pct: null }, 49.2)).toBeNull()
    expect(pourcentageVolumeLivre({ realized: 100, expected: 1000, pct: null }, null)).toBeNull()
  })
})
