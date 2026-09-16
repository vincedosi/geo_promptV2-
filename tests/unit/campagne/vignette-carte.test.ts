import { describe, it, expect } from 'vitest'
import {
  bornesStrictementCroissantes,
  bornesQuantiles,
  rampePourBornes,
  expressionEtapes,
  enveloppeFeatures,
  enveloppeGeometrie,
  domaineValeurs,
  libellesExtremites,
  type FeatureAlignementGeo,
} from '@/lib/campagne/vignette-carte'
import { BORNES_DIVERGENTES, RAMPE_MAPLIBRE } from '@/lib/campagne/palette-divergente'

describe('bornesStrictementCroissantes', () => {
  it('vrai pour une suite strictement croissante', () => {
    expect(bornesStrictementCroissantes([-50, -25, -10, 10, 25, 50])).toBe(true)
  })
  it('vrai pour un tableau vide ou à un seul élément', () => {
    expect(bornesStrictementCroissantes([])).toBe(true)
    expect(bornesStrictementCroissantes([5])).toBe(true)
  })
  it('faux sur une égalité consécutive', () => {
    expect(bornesStrictementCroissantes([1, 2, 2, 3])).toBe(false)
  })
  it('faux sur une inversion', () => {
    expect(bornesStrictementCroissantes([1, 3, 2])).toBe(false)
  })
})

describe('bornesQuantiles', () => {
  it('rend nClasses - 1 bornes pour des valeurs bien réparties', () => {
    const valeurs = Array.from({ length: 100 }, (_, i) => i)
    const bornes = bornesQuantiles(valeurs, 5)
    expect(bornes).toHaveLength(4)
    expect(bornesStrictementCroissantes(bornes)).toBe(true)
  })

  it('déduplique quand les données sont peu variées (moins de bornes que demandé)', () => {
    const valeurs = [0, 0, 0, 0, 0, 100]
    const bornes = bornesQuantiles(valeurs, 5)
    expect(bornesStrictementCroissantes(bornes)).toBe(true)
    expect(new Set(bornes).size).toBe(bornes.length)
  })

  it('ignore les valeurs non finies', () => {
    const bornes = bornesQuantiles([1, 2, Number.NaN, 3, 4, 5], 3)
    expect(bornes.every(Number.isFinite)).toBe(true)
  })

  it('tableau vide -> aucune borne', () => {
    expect(bornesQuantiles([], 5)).toEqual([])
  })

  it('nClasses < 2 -> aucune borne', () => {
    expect(bornesQuantiles([1, 2, 3], 1)).toEqual([])
  })
})

describe('rampePourBornes', () => {
  const rampe5 = ['#111', '#222', '#333', '#444', '#555']

  it('rend la rampe complète quand le nombre de bornes correspond', () => {
    expect(rampePourBornes(rampe5, 4)).toEqual(rampe5)
  })

  it('échantillonne en conservant les deux extrémités quand il y a moins de bornes', () => {
    const r = rampePourBornes(rampe5, 1) // 2 couleurs
    expect(r).toHaveLength(2)
    expect(r[0]).toBe('#111')
    expect(r[1]).toBe('#555')
  })

  it('une seule couleur si nBornes = 0', () => {
    expect(rampePourBornes(rampe5, 0)).toEqual(['#555'])
  })
})

describe('expressionEtapes', () => {
  it('construit un step MapLibre valide pour la rampe divergente existante', () => {
    const expr = expressionEtapes('ecart_pct', 'hors_plan', BORNES_DIVERGENTES, RAMPE_MAPLIBRE.dark, '#9aa0a6')
    expect(expr[0]).toBe('case')
    const step = expr[3] as unknown[]
    expect(step[0]).toBe('step')
    // ['step', ['get', prop], couleur0, borne0, couleur1, ..., borne5, couleur6]
    // = 3 éléments fixes ('step', l'expression get, la couleur initiale) + 2 par borne.
    expect(step.length).toBe(3 + BORNES_DIVERGENTES.length * 2)
  })

  it('lève une erreur si les bornes ne sont pas strictement croissantes', () => {
    expect(() => expressionEtapes('v', null, [1, 1, 2], ['a', 'b', 'c', 'd'], '#9aa0a6')).toThrow()
  })

  it('lève une erreur si la rampe n a pas exactement bornes.length + 1 couleurs', () => {
    expect(() => expressionEtapes('v', null, [1, 2], ['a', 'b'], '#9aa0a6')).toThrow()
  })

  it('la condition d absence couvre valeur NULL et le flag hors_plan', () => {
    const expr = expressionEtapes('ecart_pct', 'hors_plan', [10], ['#a', '#b'], '#gris')
    const condition = expr[1] as unknown[]
    expect(condition[0]).toBe('any')
  })

  it('sans proprieteAbsence, seule la valeur NULL déclenche le gris', () => {
    const expr = expressionEtapes('impressions', null, [10], ['#a', '#b'], '#gris')
    const condition = expr[1] as unknown[]
    expect(condition[0]).toBe('==')
  })

  it('T15-3 : bornes vides (aucune valeur finie) -> couleur littérale, jamais un step à 0 palier', () => {
    // Cas réel : `features` pas encore chargées, ou indicateur non
    // matérialisé sur tout le périmètre visible — `bornesQuantiles` rend []
    // et `rampePourBornes(rampe, 0)` rend exactement 1 couleur (voir plus haut).
    const expr = expressionEtapes('variable_valeur', null, [], ['#unique'], '#gris')
    const fallback = expr[3]
    expect(fallback).toBe('#unique')
    // Un `step` MapLibre à 0 palier (`['step', get, couleur]`, 3 éléments)
    // est rejeté au runtime — la garantie ici est qu'il n'existe plus DU TOUT :
    // le repli est une couleur, pas un tableau d'expression.
    expect(Array.isArray(fallback)).toBe(false)
  })
})

function feature(geometry: GeoJSON.Geometry): Pick<FeatureAlignementGeo, 'geometry'> {
  return { geometry }
}

describe('enveloppeFeatures', () => {
  it('calcule l enveloppe d un Polygon simple', () => {
    const f = feature({
      type: 'Polygon',
      coordinates: [[[0, 0], [2, 0], [2, 3], [0, 3], [0, 0]]],
    })
    expect(enveloppeFeatures([f])).toEqual([0, 0, 2, 3])
  })

  it('agrège plusieurs features, MultiPolygon compris', () => {
    const f1 = feature({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })
    const f2 = feature({
      type: 'MultiPolygon',
      coordinates: [[[[5, 5], [6, 5], [6, 6], [5, 5]]]],
    })
    expect(enveloppeFeatures([f1, f2])).toEqual([0, 0, 6, 6])
  })

  it('null quand aucune géométrie exploitable', () => {
    expect(enveloppeFeatures([])).toBeNull()
  })
})

describe('enveloppeGeometrie (Tâche 13B : bloc élémentaire partagé)', () => {
  it('calcule l enveloppe d une géométrie seule, identique au cas à une feature de enveloppeFeatures', () => {
    const geom: GeoJSON.Geometry = { type: 'Polygon', coordinates: [[[1, 2], [4, 2], [4, 5], [1, 5], [1, 2]]] }
    expect(enveloppeGeometrie(geom)).toEqual([1, 2, 4, 5])
  })

  it('null pour une géométrie absente', () => {
    expect(enveloppeGeometrie(undefined)).toBeNull()
  })
})

describe('domaineValeurs', () => {
  it('rend [min, max] en ignorant les null', () => {
    expect(domaineValeurs([5, null, 1, null, 9])).toEqual([1, 9])
  })
  it('null si toutes les valeurs sont absentes', () => {
    expect(domaineValeurs([null, null])).toBeNull()
  })
})

describe('libellesExtremites', () => {
  it('impressions : qualitatif "faible"/"fort" sans domaine', () => {
    expect(libellesExtremites('impressions', null)).toEqual({ finGauche: 'faible', finDroite: 'fort' })
  })
  /**
   * Ces deux cas n'assertaient que des NON-ÉGALITÉS (`not.toBe('faible')`,
   * `not.toBe('—')`) : ils vérifiaient qu'on n'affiche plus le libellé
   * qualitatif, jamais ce qu'on affiche à la place. Min et max intervertis, ou
   * 3 400 000 abrégé « 1,2 k », passaient tous les deux — et la légende des
   * vignettes « Impressions » et « Variable du plan » se lit alors à l'envers
   * sur la carte du Suivi V2.
   *
   * Valeurs attendues écrites en dur, jamais recalculées par
   * `formaterNombreAbrege` : 1 200 → « 1.2k », 3 400 000 → « 3.4M ».
   */
  it('impressions : valeurs abrégées quand un domaine existe, min à gauche', () => {
    expect(libellesExtremites('impressions', [1200, 3_400_000]))
      .toEqual({ finGauche: '1.2k', finDroite: '3.4M' })
  })
  it('variable : em-dash sans domaine, valeurs formatées sinon', () => {
    expect(libellesExtremites('variable', null)).toEqual({ finGauche: '—', finDroite: '—' })
    expect(libellesExtremites('variable', [28, 50]))
      .toEqual({ finGauche: '28', finDroite: '50' })
  })
  it('alignement : toujours "sous"/"sur", domaine ignoré', () => {
    expect(libellesExtremites('alignement', null)).toEqual({ finGauche: 'sous', finDroite: 'sur' })
    expect(libellesExtremites('alignement', [-80, 80])).toEqual({ finGauche: 'sous', finDroite: 'sur' })
  })
})
