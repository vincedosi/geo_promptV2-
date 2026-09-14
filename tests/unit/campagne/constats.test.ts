import { describe, it, expect } from 'vitest'
import { calculerConstats } from '@/lib/campagne/constats'

describe('constats de correction', () => {
  it('n affiche rien quand tout va bien', () => {
    expect(calculerConstats({
      unites: [{ code: '75', nom: 'Paris', ecart_pct: 2, impressions: 1000, cpm: 6.5 }],
      cpm_moyen: 6.5, canaux: [{ code: 'dv360', cpm: 6.4 }],
    })).toEqual([])
  })

  it('nomme les départements qui concentrent la sous-pression', () => {
    const c = calculerConstats({
      unites: [
        { code: '13', nom: 'Bouches-du-Rhône', ecart_pct: -52, impressions: 400, cpm: 6.5 },
        { code: '59', nom: 'Nord', ecart_pct: -48, impressions: 420, cpm: 6.5 },
        { code: '75', nom: 'Paris', ecart_pct: 1, impressions: 5000, cpm: 6.5 },
      ],
      cpm_moyen: 6.5, canaux: [],
    })
    expect(c[0].titre).toContain('13')
    expect(c[0].titre).toContain('59')
  })

  it('signale un canal nettement plus cher que la moyenne', () => {
    const c = calculerConstats({
      unites: [], cpm_moyen: 6.5,
      canaux: [{ code: 'tiktok', cpm: 9.2 }, { code: 'dv360', cpm: 6.1 }],
    })
    expect(c.some(x => x.titre.includes('tiktok') && x.titre.includes('41'))).toBe(true)
  })

  it('rend au plus trois constats, les plus lourds d abord', () => {
    const c = calculerConstats({
      unites: Array.from({ length: 20 }, (_, i) => ({
        code: String(i), nom: `d${i}`, ecart_pct: -60, impressions: 100, cpm: 6.5,
      })),
      cpm_moyen: 6.5, canaux: [{ code: 'tiktok', cpm: 12 }],
    })
    expect(c.length).toBeLessThanOrEqual(3)
  })
})
