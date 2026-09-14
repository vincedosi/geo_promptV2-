import { describe, it, expect } from 'vitest'
import { libelleFilAriane, LIBELLES_MAILLE } from '@/components/campagne/suivi-v2/BarreMaille'

describe('fil d Ariane', () => {
  it('annonce France entière quand aucun parent n est posé', () => {
    expect(libelleFilAriane('departement', null, null)).toEqual(['France entière'])
  })

  it('ajoute le nom du parent, jamais son code brut', () => {
    expect(libelleFilAriane('departement', '11', 'Île-de-France'))
      .toEqual(['France entière', 'Île-de-France'])
  })

  it('retombe sur le code si le nom n est pas encore chargé — jamais un trou', () => {
    expect(libelleFilAriane('cp', '13', null)).toEqual(['France entière', '13'])
  })

  it('nomme les mailles en sentence case', () => {
    expect(LIBELLES_MAILLE).toEqual({ region: 'Région', departement: 'Département', cp: 'Code postal' })
  })
})
