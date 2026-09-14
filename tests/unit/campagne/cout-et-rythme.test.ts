import { describe, it, expect } from 'vitest'
import { pourcentageDuBudget, cpmHorsPrevu } from '@/components/campagne/suivi-v2/CoutEtRythme'

describe('pourcentageDuBudget', () => {
  it('rapporte un montant au budget total', () => {
    expect(pourcentageDuBudget(1590, 25650)).toBeCloseTo(6.2, 1)
  })
  it('rend null sans budget total ou budget nul', () => {
    expect(pourcentageDuBudget(1590, null)).toBeNull()
    expect(pourcentageDuBudget(1590, 0)).toBeNull()
  })
})

describe('cpmHorsPrevu', () => {
  it('signale un CPM réel notablement au-dessus du prévu (même seuil que le canal le plus cher)', () => {
    expect(cpmHorsPrevu(9.2, 6.5)).toBe(true) // +41,5 %
  })
  it('ne signale pas un écart mineur', () => {
    expect(cpmHorsPrevu(6.53, 6.5)).toBe(false) // +0,5 %
  })
  it('rend false sans donnée', () => {
    expect(cpmHorsPrevu(null, 6.5)).toBe(false)
    expect(cpmHorsPrevu(6.5, null)).toBe(false)
    expect(cpmHorsPrevu(6.5, 0)).toBe(false)
  })
})
