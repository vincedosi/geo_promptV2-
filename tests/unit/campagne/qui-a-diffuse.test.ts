import { describe, it, expect } from 'vitest'
import { largeurBarreCanal } from '@/components/campagne/suivi-v2/QuiADiffuse'

describe('largeur de barre par canal', () => {
  it('le plus gros canal remplit 100 % de la piste', () => {
    expect(largeurBarreCanal(45.1, 45.1)).toBe(100)
  })

  it('un canal plus petit est proportionnel au plus gros', () => {
    expect(largeurBarreCanal(10, 40)).toBe(25)
  })

  it('ne divise jamais par zéro quand tous les canaux sont à 0 %', () => {
    expect(largeurBarreCanal(0, 0)).toBe(0)
    expect(Number.isFinite(largeurBarreCanal(0, 0))).toBe(true)
  })

  it('une part nulle ou absente ne dessine rien', () => {
    expect(largeurBarreCanal(null, 40)).toBe(0)
  })
})
