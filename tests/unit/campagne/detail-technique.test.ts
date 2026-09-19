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

  /**
   * Ce cas n'assertait QUE `pts[0].ideal === 0` — soit le point où la formule
   * vaut 0 quelle qu'elle soit (le premier jour EST le début de période, donc
   * `ratioTemps = 0` sous n'importe quel dénominateur). Il ne pouvait donc
   * distinguer aucun défaut de la trajectoire idéale : un `ideal` resté à 0
   * tous les jours, ou calculé sur la durée ÉCOULÉE au lieu de la durée
   * TOTALE, passaient tous les deux.
   *
   * Les trois valeurs ci-dessous sont calculées à la main : période du 01/04
   * au 04/04 = 3 jours, budget 10 000 €, donc 10 000 × 0/3, ×1/3, ×2/3.
   */
  it('la trajectoire idéale est linéaire entre le début et la fin de période', () => {
    const pts = trajectoireBudget(DAILY, 10000, '2026-04-01', '2026-04-04')
    expect(pts!.map((p) => Math.round(p.ideal))).toEqual([0, 3333, 6667])
  })

  /**
   * Le discriminant du dénominateur : la période court jusqu'au 11/04 (10
   * jours) alors que les données s'arrêtent au 03/04. La trajectoire idéale
   * doit rester calée sur la durée TOTALE de la campagne — sinon le graphe
   * « budget vs trajectoire » annonce que tout le budget devait être dépensé
   * en trois jours, et déclare en retard une campagne parfaitement à l'heure.
   *
   *   durée TOTALE (attendu)  : 10 000 × 0/10, ×1/10, ×2/10 → 0, 1 000, 2 000
   *   durée ÉCOULÉE (défaut)  : 10 000 × 0/2,  ×1/2,  ×2/2  → 0, 5 000, 10 000
   */
  it('cale la trajectoire idéale sur la durée TOTALE, pas sur la durée écoulée', () => {
    const pts = trajectoireBudget(DAILY, 10000, '2026-04-01', '2026-04-11')
    expect(pts!.map((p) => Math.round(p.ideal))).toEqual([0, 1000, 2000])
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
