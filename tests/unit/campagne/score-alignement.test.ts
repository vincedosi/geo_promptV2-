import { describe, it, expect } from 'vitest'
import {
  libelleVariation, positionEchelle, etalonAffichable,
} from '@/components/campagne/suivi-v2/ScoreAlignement'

describe('variation à 7 jours', () => {
  it('annonce une hausse au singulier', () => {
    expect(libelleVariation(1)).toEqual({ texte: '1 point en 7 jours', sens: 'hausse' })
  })

  it('annonce une hausse au pluriel', () => {
    expect(libelleVariation(6)).toEqual({ texte: '6 points en 7 jours', sens: 'hausse' })
  })

  it('annonce une baisse avec sa propre formulation, jamais un nombre négatif brut', () => {
    expect(libelleVariation(-4)).toEqual({ texte: '4 points perdus en 7 jours', sens: 'baisse' })
  })

  it('annonce la stabilité sans flèche ni nombre à zéro', () => {
    expect(libelleVariation(0)).toEqual({ texte: 'Stable sur 7 jours', sens: 'stable' })
  })
})

describe('position sur l échelle 0-100', () => {
  it('rend la valeur telle quelle dans les bornes', () => {
    expect(positionEchelle(78)).toBe(78)
    expect(positionEchelle(0)).toBe(0)
    expect(positionEchelle(100)).toBe(100)
  })

  it('borne une valeur hors [0,100] plutôt que de casser le rendu', () => {
    expect(positionEchelle(-5)).toBe(0)
    expect(positionEchelle(140)).toBe(100)
  })

  it('retombe sur 0 pour une valeur non finie', () => {
    expect(positionEchelle(NaN)).toBe(0)
  })
})

describe('étalon secteur — ruling T10-1', () => {
  it('ne rend PAS l étalon tant que n_campagnes vaut 0 — c est une convention amorcée, pas une médiane', () => {
    expect(etalonAffichable({ score_median: 64, n_campagnes: 0 })).toBeNull()
  })

  it('rend l étalon dès que n_campagnes est positif', () => {
    expect(etalonAffichable({ score_median: 64, n_campagnes: 3 })).toBe(64)
  })

  it('ne rend rien si l étalon lui-même est absent (échec de lecture côté route)', () => {
    expect(etalonAffichable(null)).toBeNull()
    expect(etalonAffichable(undefined)).toBeNull()
  })
})
