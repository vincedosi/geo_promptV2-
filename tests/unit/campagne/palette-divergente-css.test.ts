import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RAMPE_MAPLIBRE } from '@/lib/campagne/palette-divergente'

/**
 * L'échelle divergente est écrite DEUX FOIS : en tokens CSS pour le DOM, en hex
 * littéraux pour MapLibre, qui ne résout pas `var()` dans `paint`. Ce test est
 * la seule chose qui empêche les deux copies de diverger — sans lui, changer un
 * hex d'un seul côté laisse toute la suite au vert et fait afficher deux
 * échelles différentes au tableau et à la carte.
 *
 * Même patron que `tests/unit/carte/panneau-analyse-garde.test.ts` : on lit le
 * VRAI fichier, on ne simule pas son contenu.
 */

/** Ordre canonique, du plus sous-pressé au plus sur-pressé. */
const ORDRE_TOKENS = ['sous-3', 'sous-2', 'sous-1', 'neutre', 'sur-1', 'sur-2', 'sur-3'] as const

const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

/**
 * Rend le bloc du sélecteur qui porte réellement les tokens divergents.
 * `html.light` apparaît plusieurs fois dans globals.css : prendre le premier
 * bloc venu attraperait celui qui ne déclare que `color-scheme`.
 */
function blocPorteurDeTokens(selecteur: string): string {
  const blocs: string[] = []
  let i = 0
  while ((i = CSS.indexOf(selecteur, i)) !== -1) {
    const debut = CSS.indexOf('{', i)
    if (debut === -1) break
    const fin = CSS.indexOf('}', debut)
    if (fin === -1) break
    blocs.push(CSS.slice(debut, fin))
    i = debut + 1
  }
  const bloc = blocs.find(b => b.includes('--diverge-'))
  if (!bloc) throw new Error(`aucun bloc « ${selecteur} » ne porte de token --diverge-*`)
  return bloc
}

function hexDuToken(bloc: string, nom: string): string | null {
  const m = bloc.match(new RegExp(`--diverge-${nom}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`))
  return m ? m[1].toLowerCase() : null
}

describe('correspondance entre les tokens CSS et la rampe MapLibre', () => {
  it('le thème sombre de globals.css vaut RAMPE_MAPLIBRE.dark, token par token', () => {
    const bloc = blocPorteurDeTokens(':root')
    const lus = ORDRE_TOKENS.map(nom => hexDuToken(bloc, nom))
    expect(lus).toEqual(RAMPE_MAPLIBRE.dark.map(c => c.toLowerCase()))
  })

  it('le thème clair de globals.css vaut RAMPE_MAPLIBRE.light, token par token', () => {
    const bloc = blocPorteurDeTokens('html.light')
    const lus = ORDRE_TOKENS.map(nom => hexDuToken(bloc, nom))
    expect(lus).toEqual(RAMPE_MAPLIBRE.light.map(c => c.toLowerCase()))
  })

  it('aucun token divergent ne manque dans l un des deux blocs', () => {
    for (const selecteur of [':root', 'html.light']) {
      const bloc = blocPorteurDeTokens(selecteur)
      const manquants = ORDRE_TOKENS.filter(nom => hexDuToken(bloc, nom) === null)
      expect(manquants, `tokens absents de « ${selecteur} »`).toEqual([])
    }
  })
})
