import { describe, it, expect } from 'vitest'
import { pourcentageDuBudget, cpmHorsPrevu } from '@/components/campagne/suivi-v2/CoutEtRythme'
import { SEUIL_CPM_CHER } from '@/lib/campagne/constats'

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
  /**
   * Le seuil est ÉPINGLÉ, pas seulement encadré. Les deux cas précédents
   * testaient +41,5 % (vrai) et +0,5 % (faux) et laissaient tout l'intervalle
   * [1,005 ; 1,415] libre : un seuil glissé à 1,10 dans `CoutEtRythme` pendant
   * que `calculerConstats` reste à 1,25 passait sans rougir, et les deux
   * écrans se contredisaient — le bandeau « CPM au-dessus du prévu » s'allumant
   * sur des campagnes que « Ce qu'il faut corriger » juge saines.
   *
   * `SEUIL_CPM_CHER` vaut 1,25 et est EXPORTÉ pour cette raison même.
   * 6,5 × 1,25 = 8,125, et la comparaison est stricte (`>`).
   */
  it('partage exactement SEUIL_CPM_CHER avec « le canal le plus cher »', () => {
    expect(SEUIL_CPM_CHER).toBe(1.25)
  })
  it('ne bascule qu au-delà du seuil, à la décimale près', () => {
    expect(cpmHorsPrevu(8.125, 6.5)).toBe(false)  // pile au seuil : pas « hors prévu »
    expect(cpmHorsPrevu(8.126, 6.5)).toBe(true)   // juste au-dessus
    // Un seuil glissé à 1,10 (7,15 €) rendrait `true` sur les deux lignes ;
    // un seuil glissé à 1,40 (9,10 €) rendrait `false` sur les deux.
  })
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
