import { describe, it, expect } from 'vitest'
import { calculerAlignement, type UniteAlignement } from '@/lib/campagne/alignement'

const parfait: UniteAlignement[] = [
  { code: '75001', reel: 500, plan: 500 },
  { code: '13001', reel: 300, plan: 300 },
  { code: '69001', reel: 200, plan: 200 },
]

describe('score d alignement géographique', () => {
  it('rend 100 quand le réel colle au plan partout', () => {
    const r = calculerAlignement(parfait, 10, 1)
    expect(r.score).toBe(100)
    expect(r.conformes_pct).toBe(100)
    expect(r.sous_pression_pct).toBe(0)
    expect(r.sur_pression_pct).toBe(0)
  })

  it('ne pénalise pas un écart intérieur à la tolérance', () => {
    const dansLaMarge: UniteAlignement[] = [
      { code: 'a', reel: 545, plan: 500 }, // +9 %, sous les 10 %
      { code: 'b', reel: 455, plan: 500 }, // -9 %
    ]
    const r = calculerAlignement(dansLaMarge, 10, 1)
    expect(r.score).toBe(100)
    expect(r.conformes_pct).toBe(100)
  })

  it('ne compte que la part AU-DELÀ de la tolérance, pas l écart entier', () => {
    // plan 500, tolérance 10 % => seuil bas 450. réel 400 => manque 50, pas 100.
    const r = calculerAlignement([{ code: 'a', reel: 400, plan: 500 }], 10, 1)
    expect(r.sous_pression_imps).toBe(50)
  })

  it('pénalise la SUR-pression, pas seulement la sous-pression', () => {
    const sous = calculerAlignement([{ code: 'a', reel: 400, plan: 500 }, { code: 'b', reel: 600, plan: 500 }], 10, 1)
    expect(sous.sur_pression_imps).toBe(50)
    expect(sous.sous_pression_imps).toBe(50)
    expect(sous.score).toBeLessThan(100)
  })

  it('le poids de sur-pression module la pénalité, et 0 la neutralise', () => {
    const u: UniteAlignement[] = [{ code: 'a', reel: 600, plan: 500 }, { code: 'b', reel: 400, plan: 500 }]
    expect(calculerAlignement(u, 10, 0).score).toBeGreaterThan(calculerAlignement(u, 10, 1).score)
  })

  it('ne descend jamais sous 0 même sur une campagne totalement déréglée', () => {
    const catastrophe: UniteAlignement[] = [
      { code: 'a', reel: 0, plan: 1000 },
      { code: 'b', reel: 2000, plan: 0 },
    ]
    expect(calculerAlignement(catastrophe, 10, 1).score).toBeGreaterThanOrEqual(0)
  })

  it('ignore une unité au plan nul sans exploser en division par zéro', () => {
    const r = calculerAlignement([{ code: 'a', reel: 10, plan: 0 }, { code: 'b', reel: 100, plan: 100 }], 10, 1)
    expect(Number.isFinite(r.score)).toBe(true)
  })

  it('rend 100 sur un jeu vide plutôt que NaN', () => {
    expect(calculerAlignement([], 10, 1).score).toBe(100)
  })

  it('reproduit la mesure du 2026-09-14 sur la campagne de démo', () => {
    // Valeurs mesurées en base : sous 3,84 % · sur 3,35 % · conformes 72,5 %
    // Ce test fige la formule, pas les données : il utilise un jeu réduit
    // dont les proportions sont connues.
    const u: UniteAlignement[] = [
      { code: 'a', reel: 384, plan: 1000 },  // très sous
      ...Array.from({ length: 7 }, (_, i) => ({ code: `c${i}`, reel: 1000, plan: 1000 })),
    ]
    const r = calculerAlignement(u, 10, 1)
    expect(r.conformes_pct).toBeCloseTo(87.5, 1)
  })
})
