import { describe, it, expect } from 'vitest'
import { trajectoireBudget, premierJourDecrochage } from '@/components/campagne/suivi-v2/DetailTechnique'

describe('trajectoireBudget', () => {
  const DAILY = [
    { date: '2026-04-01', spend: 2500 },
    { date: '2026-04-02', spend: 2500 },
    { date: '2026-04-03', spend: 2500 },
  ]

  it('cumule le réel jour après jour', () => {
    const pts = trajectoireBudget(DAILY, 10000, '2026-04-01', '2026-04-04')
    expect(pts).not.toBeNull()
    expect(pts!.map((p) => p.reel)).toEqual([2500, 5000, 7500])
  })

  it('la trajectoire idéale est linéaire entre le début et la fin de période', () => {
    const pts = trajectoireBudget(DAILY, 10000, '2026-04-01', '2026-04-04')
    // 2026-04-01 = début (ratio 0) -> idéal 0 ; 2026-04-04 = fin (ratio 1) -> idéal = budget
    expect(pts![0].ideal).toBe(0)
  })

  it('trie les jours même reçus dans le désordre', () => {
    const desordre = [DAILY[2], DAILY[0], DAILY[1]]
    const pts = trajectoireBudget(desordre, 10000, '2026-04-01', '2026-04-04')
    expect(pts!.map((p) => p.date)).toEqual(['2026-04-01', '2026-04-02', '2026-04-03'])
  })

  it('rend null sans budget total', () => {
    expect(trajectoireBudget(DAILY, null, '2026-04-01', '2026-04-04')).toBeNull()
    expect(trajectoireBudget(DAILY, 0, '2026-04-01', '2026-04-04')).toBeNull()
  })

  it('rend null sans période exploitable', () => {
    expect(trajectoireBudget(DAILY, 10000, null, '2026-04-04')).toBeNull()
    expect(trajectoireBudget(DAILY, 10000, '2026-04-04', '2026-04-01')).toBeNull() // fin avant début
  })

  it('rend null sans donnée quotidienne', () => {
    expect(trajectoireBudget([], 10000, '2026-04-01', '2026-04-04')).toBeNull()
  })
})

describe('premierJourDecrochage', () => {
  it('trouve le premier jour où l’écart dépasse 2 % du budget', () => {
    const points = [
      { date: '2026-04-01', ideal: 1000, reel: 1000 },
      { date: '2026-04-02', ideal: 2000, reel: 2010 }, // écart 0,1 % du budget
      { date: '2026-04-03', ideal: 3000, reel: 3300 }, // écart 3 % du budget -> décroche ici
    ]
    expect(premierJourDecrochage(points, 10000)).toBe('2026-04-03')
  })

  it('rend null quand la trajectoire reste tenue', () => {
    const points = [
      { date: '2026-04-01', ideal: 1000, reel: 1005 },
      { date: '2026-04-02', ideal: 2000, reel: 1990 },
    ]
    expect(premierJourDecrochage(points, 10000)).toBeNull()
  })
})
