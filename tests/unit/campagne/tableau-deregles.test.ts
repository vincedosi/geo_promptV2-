import { describe, it, expect } from 'vitest'
import { trierDeregles, largeurBarre, graviteEcart, type UniteMaille } from '@/components/campagne/suivi-v2/TableauDeregles'
import { RAMPE_CSS, trancheDivergente } from '@/lib/campagne/palette-divergente'

const UNITES = [
  { code: '13', nom: 'Bouches-du-Rhône', ecart_pct: -52, impressions: 400, cpm: 6.5, spend: 2600, plan: 830 },
  { code: '75', nom: 'Paris', ecart_pct: 31, impressions: 5000, cpm: 6.1, spend: 30500, plan: 3800 },
  { code: '59', nom: 'Nord', ecart_pct: -4, impressions: 900, cpm: 6.4, spend: 5760, plan: 940 },
]

describe('tableau des unités déréglées', () => {
  it('en bascule sous-pression, ne montre QUE les unités sous le plan', () => {
    const r = trierDeregles(UNITES, 'sous')
    expect(r.every(u => (u.ecart_pct ?? 0) < 0)).toBe(true)
    expect(r[0].code).toBe('13') // la pire d'abord
  })

  it('en bascule sur-pression, ne montre QUE celles au-dessus', () => {
    const r = trierDeregles(UNITES, 'sur')
    expect(r.map(u => u.code)).toEqual(['75'])
  })

  it('la barre part à gauche pour un manque, à droite pour un excès', () => {
    expect(largeurBarre(-52).cote).toBe('gauche')
    expect(largeurBarre(31).cote).toBe('droite')
  })

  it('la barre est centrée sur le plan : zéro ne dessine rien d un côté ni de l autre', () => {
    expect(largeurBarre(0).pct).toBe(0)
  })

  it('borne la barre à 100 % pour qu une unité à -95 % ne déborde pas de la cellule', () => {
    expect(largeurBarre(-300).pct).toBeLessThanOrEqual(100)
    expect(largeurBarre(900).pct).toBeLessThanOrEqual(100)
  })
})

/**
 * Ruling T6-3 / T11-2 : 400 CP sur 2 041 (19,6 %, mesuré le 2026-09-14) ont
 * reçu des impressions avec un plan NUL — `ecart_pct` y est `null`, aucun
 * pourcentage n'y est définissable. Ce sont pourtant la sur-pression la plus
 * pure qui soit (TOUT leur volume est en trop) : elles ne doivent jamais
 * disparaître d'un tri qui, par accident, ignorerait les `ecart_pct` nuls.
 */
describe('unités hors plan — ne doivent jamais disparaître (constrainte 2 du brief)', () => {
  const AVEC_HORS_PLAN: UniteMaille[] = [
    ...UNITES,
    { code: '971', nom: 'Guadeloupe', ecart_pct: null, impressions: 300, cpm: 5.8, spend: 1740, plan: 0, hors_plan: true },
  ]

  it('une unité hors plan compte en sur-pression — elle est la sur-pression la plus pure', () => {
    const r = trierDeregles(AVEC_HORS_PLAN, 'sur')
    expect(r.map(u => u.code)).toContain('971')
  })

  it('une unité hors plan ne compte jamais en sous-pression', () => {
    const r = trierDeregles(AVEC_HORS_PLAN, 'sous')
    expect(r.map(u => u.code)).not.toContain('971')
  })

  it('ne tronque jamais au-delà de sept lignes', () => {
    const beaucoup: UniteMaille[] = Array.from({ length: 12 }, (_, i) => ({
      code: String(i), nom: `Zone ${i}`, ecart_pct: -10 - i, impressions: 100 + i, cpm: 6, spend: 600, plan: 200,
    }))
    expect(trierDeregles(beaucoup, 'sous')).toHaveLength(7)
  })
})

/**
 * Ruling T14-2 : `graviteEcart` remplace l'ancien `tonEcart` (asymétrique,
 * `--danger`/`--warning`/`--info`, où +900 % restait la teinte la plus
 * calme) par l'échelle divergente PARTAGÉE à sept paliers
 * (`trancheDivergente`/`RAMPE_CSS`, `lib/campagne/palette-divergente.ts`) —
 * la même que `GraphiqueEcart.tsx`/`CarteVignette.tsx`/`DiffusionMapLayer.tsx`
 * pour le même champ `ecart_pct`. C'était la seule fonction du fichier sans
 * test.
 */
describe('graviteEcart — échelle divergente partagée, jamais une échelle recopiée', () => {
  it('délègue exactement à trancheDivergente pour un écart défini', () => {
    for (const e of [-90, -52, -10, 0, 4, 31, 900]) {
      expect(graviteEcart(e)).toBe(trancheDivergente(e))
    }
  })

  it('est symétrique : un +60 % et un -60 % sont aussi graves l un que l autre', () => {
    const centre = (RAMPE_CSS.length - 1) / 2 // indice de la tranche « conforme »
    const distanceSous = Math.abs(graviteEcart(-60) - centre)
    const distanceSur = Math.abs(graviteEcart(60) - centre)
    expect(distanceSous).toBe(distanceSur)
    // Concrètement : les deux tombent sur la tranche la plus extrême de leur côté.
    expect(graviteEcart(-60)).toBe(0)
    expect(graviteEcart(60)).toBe(RAMPE_CSS.length - 1)
  })

  it('les bornes exactes basculent dans la tranche supérieure (même comportement que trancheDivergente)', () => {
    expect(graviteEcart(-50)).toBe(trancheDivergente(-50))
    expect(graviteEcart(-50.01)).toBe(trancheDivergente(-50.01))
    expect(graviteEcart(-50)).not.toBe(graviteEcart(-50.01))
  })

  it('un écart nul (conforme) tombe sur la tranche centrale', () => {
    expect(graviteEcart(0)).toBe(3)
  })

  it('une unité hors plan (ecart_pct null, hors_plan true) vaut TOUJOURS l indice le plus extrême côté sur-pression', () => {
    expect(graviteEcart(null, true)).toBe(RAMPE_CSS.length - 1)
  })

  it('un ecart_pct null SANS hors_plan (cas non couvert par le brief) se rend aussi comme le plus extrême, jamais une case vide', () => {
    expect(graviteEcart(null)).toBe(RAMPE_CSS.length - 1)
  })

  it('rend toujours un indice valide dans RAMPE_CSS', () => {
    for (const e of [-900, -60, 0, 60, 900]) {
      const i = graviteEcart(e)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(RAMPE_CSS.length)
      expect(RAMPE_CSS[i]).toMatch(/^var\(--diverge-[a-z0-9-]+\)$/)
    }
  })
})
