import { describe, it, expect } from 'vitest'
import { BORNES_DIVERGENTES, couleurDivergente, RAMPE_MAPLIBRE, RAMPE_CSS, trancheDivergente } from '@/lib/campagne/palette-divergente'

describe('échelle divergente', () => {
  it('est symétrique autour de zéro — sinon la sur-pression paraît moins grave', () => {
    const neg = BORNES_DIVERGENTES.filter(b => b < 0).map(Math.abs).sort((a, b) => a - b)
    const pos = BORNES_DIVERGENTES.filter(b => b > 0).sort((a, b) => a - b)
    expect(neg).toEqual(pos)
  })

  it('a une teinte neutre PROPRE à chaque thème — un gris de dark est illisible sur fond clair', () => {
    expect(couleurDivergente(0, 'dark')).not.toBe(couleurDivergente(0, 'light'))
  })

  it('rend des hex littéraux — MapLibre ne résout pas var()', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const c of RAMPE_MAPLIBRE[theme]) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('a autant de couleurs que de tranches', () => {
    expect(RAMPE_MAPLIBRE.dark).toHaveLength(BORNES_DIVERGENTES.length + 1)
    expect(RAMPE_MAPLIBRE.light).toHaveLength(BORNES_DIVERGENTES.length + 1)
  })

  it('classe correctement les trois cas métier', () => {
    expect(couleurDivergente(-60, 'dark')).toBe(RAMPE_MAPLIBRE.dark[0])
    expect(couleurDivergente(0, 'dark')).toBe(RAMPE_MAPLIBRE.dark[3])
    expect(couleurDivergente(60, 'dark')).toBe(RAMPE_MAPLIBRE.dark[6])
  })
})

/**
 * `trancheDivergente`/`RAMPE_CSS` — le miroir CSS de `couleurDivergente`,
 * pour les composants DOM (`TableauDeregles.tsx`, ruling T14-2). Verrouille
 * que `couleurDivergente` et `RAMPE_CSS` restent indexés EXACTEMENT de la
 * même façon (même marche de seuils, même ordre de teintes).
 */
describe('trancheDivergente / RAMPE_CSS — miroir CSS de couleurDivergente', () => {
  it('a une entrée CSS par tranche, dans le même ordre que RAMPE_MAPLIBRE', () => {
    expect(RAMPE_CSS).toHaveLength(BORNES_DIVERGENTES.length + 1)
    expect(RAMPE_CSS).toHaveLength(RAMPE_MAPLIBRE.dark.length)
  })

  it('rend des var(--diverge-*), jamais un hex — c est le DOM, pas MapLibre', () => {
    for (const c of RAMPE_CSS) expect(c).toMatch(/^var\(--diverge-[a-z0-9-]+\)$/)
  })

  it('couleurDivergente et trancheDivergente partagent la même marche de seuils', () => {
    for (const e of [-90, -60, -50, -25, -10, -1, 0, 1, 10, 25, 50, 60, 900]) {
      expect(couleurDivergente(e, 'dark')).toBe(RAMPE_MAPLIBRE.dark[trancheDivergente(e)])
      expect(RAMPE_CSS[trancheDivergente(e)]).toBeDefined()
    }
  })

  it('borne exacte : la valeur d une borne bascule DANS la tranche supérieure (>=), pas en dessous', () => {
    expect(trancheDivergente(-50)).toBe(1) // pile -50 : déjà sorti de la tranche la plus extrême (index 0)
    expect(trancheDivergente(-50.01)).toBe(0)
  })
})
