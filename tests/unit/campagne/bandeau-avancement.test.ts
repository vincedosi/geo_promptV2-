import { describe, it, expect } from 'vitest'
import {
  largeurPiste,
  ecartRythme,
  projectionResteBudget,
  formaterJourMois,
} from '@/components/campagne/suivi-v2/BandeauAvancement'

describe('largeurPiste', () => {
  it('borne à [0,100]', () => {
    expect(largeurPiste(150)).toBe(100)
    expect(largeurPiste(-10)).toBe(0)
    expect(largeurPiste(49.2)).toBe(49.2)
  })
  it('rend 0 sur une donnée dégradée', () => {
    expect(largeurPiste(null)).toBe(0)
    expect(largeurPiste(undefined)).toBe(0)
    expect(largeurPiste(NaN)).toBe(0)
  })
})

describe('ecartRythme', () => {
  it('détecte un retard (temps devant le budget)', () => {
    expect(ecartRythme(49.2, 39.5)).toEqual({ points: 10, sens: 'retard' })
  })
  it('détecte une avance (budget devant le temps)', () => {
    expect(ecartRythme(30, 45)).toEqual({ points: 15, sens: 'avance' })
  })
  it('rend aligné à écart nul', () => {
    expect(ecartRythme(40, 40)).toEqual({ points: 0, sens: 'aligne' })
  })
  it('rend null si une part manque', () => {
    expect(ecartRythme(null, 40)).toBeNull()
    expect(ecartRythme(40, null)).toBeNull()
  })
})

describe('projectionResteBudget', () => {
  it('projette linéairement ce qu il resterait du budget au terme', () => {
    // 10472 dépensés à 49,2 % du temps => projeté ≈ 21284,55 sur 26500 => reste ≈ 5215,45
    expect(projectionResteBudget(10472, 49.2, 26500)).toBeCloseTo(5215.45, 0)
  })
  it('rend un reste négatif en cas de dépassement projeté', () => {
    // 20000 dépensés à 30 % du temps => projeté ≈ 66666,67 sur 26500 => reste très négatif
    expect(projectionResteBudget(20000, 30, 26500)).toBeLessThan(0)
  })
  it('rend null sans temps écoulé positif ou sans budget total', () => {
    expect(projectionResteBudget(1000, 0, 26500)).toBeNull()
    expect(projectionResteBudget(1000, null, 26500)).toBeNull()
    expect(projectionResteBudget(1000, 50, null)).toBeNull()
  })
})

describe('formaterJourMois', () => {
  it('rend jour + mois en toutes lettres, sans année', () => {
    expect(formaterJourMois('2026-04-30')).toBe('30 avril')
  })
  it('rend null sans date ou sur une date invalide', () => {
    expect(formaterJourMois(null)).toBeNull()
    expect(formaterJourMois('pas-une-date')).toBeNull()
  })
})
