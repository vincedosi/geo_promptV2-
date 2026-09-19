import { describe, it, expect } from 'vitest'
import { calculerAlignement, type UniteAlignement } from '@/lib/campagne/alignement'

/** `calculerAlignement` rend `null` si le score n'est pas calculable. */
function score(unites: UniteAlignement[]): number {
  const r = calculerAlignement(unites, 10, 1)
  if (r === null) throw new Error('score attendu calculable, recu null')
  return r.score
}

/** Deux CP d'un même département, déréglés en sens OPPOSÉS. */
const CPS: UniteAlignement[] = [
  { code: '13001', reel: 200, plan: 1000 },  // très sous-pression
  { code: '13002', reel: 1800, plan: 1000 }, // très sur-pression
]
/** Le même département, agrégé : les deux écarts s'annulent parfaitement. */
const DEPT: UniteAlignement[] = [{ code: '13', reel: 2000, plan: 2000 }]

describe('invariance du score à la maille', () => {
  it('agréger AVANT de calculer efface les écarts — c est le piège à éviter', () => {
    expect(score(DEPT)).toBe(100)
    expect(score(CPS)).toBeLessThan(100)
  })

  it('l écart entre les deux lectures est massif, pas marginal', () => {
    const auCp = score(CPS)
    const auDept = score(DEPT)
    // 100 contre 65 : un score calculé à la mauvaise maille ne se corrige pas
    // « à peu près », il raconte l'inverse de la vérité.
    expect(auDept - auCp).toBeGreaterThan(30)
  })
})
