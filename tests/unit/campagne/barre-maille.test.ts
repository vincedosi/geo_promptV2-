import { describe, it, expect } from 'vitest'
import { libelleFilAriane, LIBELLES_MAILLE, MAILLE_RACINE } from '@/components/campagne/suivi-v2/BarreMaille'

describe('fil d Ariane', () => {
  it('annonce France entière quand aucun parent n est posé', () => {
    expect(libelleFilAriane('departement', null, null)).toEqual(['France entière'])
  })

  it('ajoute le nom du parent, jamais son code brut', () => {
    expect(libelleFilAriane('departement', '11', 'Île-de-France'))
      .toEqual(['France entière', 'Région Île-de-France'])
  })

  it('retombe sur le code si le nom n est pas encore chargé — jamais un trou', () => {
    expect(libelleFilAriane('cp', '13', null)).toEqual(['France entière', 'Département 13'])
  })

  // La session ne porte qu'UN parent : après un drill région → département →
  // CP, « 31 » est un DÉPARTEMENT et le fil le disait seulement « 31 ».
  it('qualifie le parent par SA maille, deduite de la maille courante', () => {
    expect(libelleFilAriane('cp', '31', 'Haute-Garonne'))
      .toEqual(['France entière', 'Département Haute-Garonne'])
    expect(libelleFilAriane('region', '11', 'Île-de-France'))
      .toEqual(['France entière', 'Île-de-France'])
  })

  it('la racine du fil est la maille region — jamais celle ou on se trouve', () => {
    expect(MAILLE_RACINE).toBe('region')
  })

  it('nomme les mailles en sentence case', () => {
    expect(LIBELLES_MAILLE).toEqual({ region: 'Région', departement: 'Département', cp: 'Code postal' })
  })
})
