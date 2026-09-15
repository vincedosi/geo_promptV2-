import { describe, it, expect } from 'vitest'
import {
  indexTranche,
  preparerDispersion,
  formaterPlageTranche,
  construireSeriesCourbe,
  selectionnerAnnotations,
  type TrancheDispersion,
  type UniteAlignement,
} from '@/lib/campagne/graphique-ecart'

describe('indexTranche', () => {
  it('rend 0 pour la borne basse ouverte (extrémité sous-pression)', () => {
    expect(indexTranche(null, -50)).toBe(0)
  })
  it('rend 6 pour la borne haute ouverte (extrémité sur-pression)', () => {
    expect(indexTranche(50, null)).toBe(6)
  })
  it('rend 3 pour la bande conforme, au centre', () => {
    expect(indexTranche(-10, 10)).toBe(3)
  })
  it('rend les positions intermédiaires dans l ordre des BORNES_DIVERGENTES', () => {
    expect(indexTranche(-25, -10)).toBe(2)
    expect(indexTranche(10, 25)).toBe(4)
    expect(indexTranche(25, 50)).toBe(5)
  })
  it('rend null pour la tranche hors plan (les deux bornes nulles)', () => {
    expect(indexTranche(null, null)).toBeNull()
  })
  it('rend null sur une borne inconnue plutôt que de deviner une position', () => {
    expect(indexTranche(-33, -10)).toBeNull()
  })
})

describe('preparerDispersion', () => {
  // Forme réelle mesurée sur la campagne demo (dccc0000-0000-4000-8000-000000000002),
  // vue nationale : 52+109+1480 dans 3 bandes + 400 CP hors plan = 2041.
  const tranches: TrancheDispersion[] = [
    { borne_basse: null, borne_haute: -50, n_cp: 52, impressions: 50370 },
    { borne_basse: -50, borne_haute: -25, n_cp: 109, impressions: 146760 },
    { borne_basse: -10, borne_haute: 10, n_cp: 1480, impressions: 3607260 },
    { borne_basse: null, borne_haute: null, n_cp: 400, impressions: 132000 },
  ]

  it('sépare les bandes numérotées de la ligne hors plan', () => {
    const { barres, horsPlan } = preparerDispersion(tranches)
    expect(barres).toHaveLength(3)
    expect(horsPlan).toEqual({ n_cp: 400, impressions: 132000 })
  })

  it('conserve tous les CP : la somme des bandes + hors plan retombe sur le total', () => {
    const { barres, horsPlan } = preparerDispersion(tranches)
    const total = barres.reduce((s, b) => s + b.n_cp, 0) + (horsPlan?.n_cp ?? 0)
    expect(total).toBe(2041)
  })

  it('ordonne les barres par position croissante, même si le payload arrive dans le désordre', () => {
    const melange = [tranches[2], tranches[0], tranches[1], tranches[3]]
    const { barres } = preparerDispersion(melange)
    expect(barres.map((b) => b.index)).toEqual([0, 1, 3])
  })

  it('porte le libellé LIBELLES_TRANCHES correspondant à chaque position', () => {
    const { barres } = preparerDispersion(tranches)
    const conforme = barres.find((b) => b.index === 3)
    expect(conforme?.libelle).toBe('conforme')
  })

  it('rend horsPlan à null quand aucune ligne hors plan n arrive', () => {
    const { horsPlan } = preparerDispersion(tranches.slice(0, 3))
    expect(horsPlan).toBeNull()
  })
})

describe('formaterPlageTranche', () => {
  it('borne ouverte basse', () => expect(formaterPlageTranche(null, -50)).toBe('-50 % et moins'))
  it('borne ouverte haute', () => expect(formaterPlageTranche(50, null)).toBe('50 % et plus'))
  it('bande fermée', () => expect(formaterPlageTranche(-10, 10)).toBe('-10 % à 10 %'))
  it('hors plan (deux bornes nulles)', () => expect(formaterPlageTranche(null, null)).toBe('hors plan'))
})

function unite(patch: Partial<UniteAlignement>): UniteAlignement {
  return {
    code: 'X', nom: 'X', impressions: 0, spend: 0, cpm: 0,
    plan: 0, ecart_pct: 0, hors_plan: false, volume_deplace: 0,
    ...patch,
  }
}

describe('construireSeriesCourbe', () => {
  it('trie par plan décroissant', () => {
    const unites = [
      unite({ code: 'A', plan: 100, impressions: 90 }),
      unite({ code: 'B', plan: 300, impressions: 280 }),
      unite({ code: 'C', plan: 200, impressions: 210 }),
    ]
    const serie = construireSeriesCourbe(unites, 'departement')
    expect(serie.map((p) => p.code)).toEqual(['B', 'C', 'A'])
  })

  it('borne à LIMITE_COURBE[maille] (12 en région)', () => {
    const unites = Array.from({ length: 20 }, (_, i) =>
      unite({ code: `R${i}`, plan: 20 - i, impressions: 20 - i }))
    expect(construireSeriesCourbe(unites, 'region')).toHaveLength(12)
  })

  it('calcule min/gapSous/gapSur pour une unité sous-pression', () => {
    const [p] = construireSeriesCourbe([unite({ code: 'A', plan: 100, impressions: 60 })], 'departement')
    expect(p).toMatchObject({ min: 60, gapSous: 40, gapSur: 0 })
  })

  it('calcule min/gapSous/gapSur pour une unité sur-pression', () => {
    const [p] = construireSeriesCourbe([unite({ code: 'A', plan: 100, impressions: 140 })], 'departement')
    expect(p).toMatchObject({ min: 100, gapSous: 0, gapSur: 40 })
  })

  it('n exclut pas les unités hors plan : plan traité comme 0, tout le réel en sur-pression', () => {
    const [p] = construireSeriesCourbe(
      [unite({ code: 'A', plan: null, impressions: 500, hors_plan: true })], 'departement',
    )
    expect(p).toMatchObject({ plan: 0, reel: 500, min: 0, gapSous: 0, gapSur: 500 })
  })
})

describe('selectionnerAnnotations', () => {
  const points = construireSeriesCourbe(
    [
      unite({ code: 'A', plan: 100, impressions: 100, ecart_pct: 0 }),
      unite({ code: 'B', plan: 100, impressions: 20, ecart_pct: -80 }),
      unite({ code: 'C', plan: 100, impressions: 105, ecart_pct: 5 }),
      unite({ code: 'D', plan: 100, impressions: 250, ecart_pct: 150 }),
      unite({ code: 'E', plan: 100, impressions: 60, ecart_pct: -40 }),
      unite({ code: 'F', plan: 100, impressions: 90, ecart_pct: -10 }),
    ],
    'departement',
  )

  it('sélectionne les plus déréglés par écart absolu, jamais tout le monde', () => {
    const annotes = selectionnerAnnotations(points, 3)
    expect(annotes.map((p) => p.code)).toEqual(['D', 'B', 'E'])
  })

  it('respecte le plafond demandé', () => {
    expect(selectionnerAnnotations(points, 2)).toHaveLength(2)
  })

  it('exclut les unités sans écart définissable (hors plan)', () => {
    const avecHorsPlan = [...points, construireSeriesCourbe(
      [unite({ code: 'Z', plan: null, impressions: 900, ecart_pct: null, hors_plan: true })], 'departement',
    )[0]]
    const annotes = selectionnerAnnotations(avecHorsPlan, 10)
    expect(annotes.some((p) => p.code === 'Z')).toBe(false)
  })

  it('générique (Tâche 13B) : fonctionne sur toute forme portant ecart_pct, pas seulement PointCourbe', () => {
    const items = [
      { code: 'A', ecart_pct: 5 },
      { code: 'B', ecart_pct: -80 },
      { code: 'C', ecart_pct: null },
    ]
    const annotes = selectionnerAnnotations(items, 2)
    expect(annotes.map((p) => p.code)).toEqual(['B', 'A'])
  })
})
