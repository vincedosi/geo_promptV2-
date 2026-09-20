import { describe, it, expect } from 'vitest'
import {
  centreFeature,
  libelleEtiquette,
  zonesAAnnoter,
  bboxVersParametre,
} from '@/lib/campagne/diffusion-carte'
import type { FeatureAlignementGeo } from '@/lib/campagne/vignette-carte'

function feature(over: Partial<FeatureAlignementGeo> = {}): FeatureAlignementGeo {
  return {
    code: '75', nom: 'Paris', impressions: 1000, ecart_pct: 0, hors_plan: false,
    variable_valeur: null, part_plan_pct: null,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
    ...over,
  }
}

describe('centreFeature', () => {
  it('rend le milieu de l enveloppe d un Polygon', () => {
    expect(centreFeature(feature())).toEqual([1, 1])
  })

  it('null quand la géométrie est absente ou inexploitable', () => {
    expect(centreFeature({ geometry: undefined as unknown as GeoJSON.Geometry })).toBeNull()
  })
})

describe('libelleEtiquette', () => {
  it('préfère le nom au code', () => {
    expect(libelleEtiquette('Paris', '75')).toBe('Paris')
  })

  it('replie sur le code quand le nom est absent ou vide', () => {
    expect(libelleEtiquette(null, '75')).toBe('75')
    expect(libelleEtiquette('   ', '75')).toBe('75')
  })

  it('rend un tiret cadratin quand ni nom ni code ne sont disponibles', () => {
    expect(libelleEtiquette(null, null)).toBe('—')
  })

  it('tronque un nom trop long avec une ellipse, jamais un débordement', () => {
    const long = 'Un nom de zone vraiment beaucoup trop long pour une étiquette'
    const court = libelleEtiquette(long, '75', 10)
    expect(court.length).toBe(10)
    expect(court.endsWith('…')).toBe(true)
  })
})

describe('zonesAAnnoter', () => {
  it('sélectionne les plus déréglées, avec leur centre résolu', () => {
    const features = [
      feature({ code: 'A', nom: 'A', ecart_pct: 5 }),
      feature({ code: 'B', nom: 'B', ecart_pct: -80 }),
      feature({ code: 'C', nom: 'C', ecart_pct: 150 }),
    ]
    const etiquettes = zonesAAnnoter(features, 2)
    expect(etiquettes.map((e) => e.code)).toEqual(['C', 'B'])
    expect(etiquettes[0].centre).toEqual([1, 1])
  })

  it('exclut les zones hors plan (ecart_pct null), même si elles portent du volume', () => {
    const features = [
      feature({ code: 'A', ecart_pct: null, hors_plan: true, impressions: 900000 }),
      feature({ code: 'B', ecart_pct: -30 }),
    ]
    const etiquettes = zonesAAnnoter(features, 5)
    expect(etiquettes.map((e) => e.code)).toEqual(['B'])
  })

  it('écarte silencieusement une zone sélectionnée mais sans géométrie exploitable', () => {
    const features = [
      feature({ code: 'A', ecart_pct: 90, geometry: undefined as unknown as GeoJSON.Geometry }),
      feature({ code: 'B', ecart_pct: 10 }),
    ]
    const etiquettes = zonesAAnnoter(features, 5)
    expect(etiquettes.map((e) => e.code)).toEqual(['B'])
  })

  it('respecte le plafond demandé', () => {
    const features = Array.from({ length: 10 }, (_, i) =>
      feature({ code: String(i), ecart_pct: i * 10 }))
    expect(zonesAAnnoter(features, 3)).toHaveLength(3)
  })
})

describe('bboxVersParametre', () => {
  it('formate à 3 décimales, séparées par des virgules', () => {
    expect(bboxVersParametre([-5.5, 41.2, 9.8, 51.2])).toBe('-5.500,41.200,9.800,51.200')
  })

  it('deux viewports arrondis à la même valeur rendent la même clé', () => {
    const a = bboxVersParametre([2.34999, 48.85001, 2.4, 48.9])
    const b = bboxVersParametre([2.35001, 48.84999, 2.4, 48.9])
    expect(a).toBe(b)
  })
})
