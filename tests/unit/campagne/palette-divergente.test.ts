import { describe, it, expect } from 'vitest'
import { BORNES_DIVERGENTES, couleurDivergente, RAMPE_MAPLIBRE } from '@/lib/campagne/palette-divergente'

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
