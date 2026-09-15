import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RAMPE_SEQUENTIELLE } from '@/lib/campagne/palette-sequentielle'

/**
 * Même garde-fou que `palette-divergente-css.test.ts` : l'échelle
 * séquentielle est écrite deux fois (tokens CSS pour le DOM, hex littéraux
 * pour MapLibre) et ce test est la seule chose qui empêche les deux copies de
 * diverger. On lit le VRAI fichier CSS, on ne simule pas son contenu.
 */

const ORDRE_TOKENS = ['1', '2', '3', '4', '5'] as const

const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

/**
 * Rend le bloc du sélecteur qui porte réellement les tokens `--seq-*`.
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
  const bloc = blocs.find(b => b.includes('--seq-'))
  if (!bloc) throw new Error(`aucun bloc « ${selecteur} » ne porte de token --seq-*`)
  return bloc
}

function hexDuToken(bloc: string, nom: string): string | null {
  const m = bloc.match(new RegExp(`--seq-${nom}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`))
  return m ? m[1].toLowerCase() : null
}

describe('correspondance entre les tokens CSS et la rampe séquentielle MapLibre', () => {
  it('le thème sombre de globals.css vaut RAMPE_SEQUENTIELLE.dark, token par token', () => {
    const bloc = blocPorteurDeTokens(':root')
    const lus = ORDRE_TOKENS.map(nom => hexDuToken(bloc, nom))
    expect(lus).toEqual(RAMPE_SEQUENTIELLE.dark.map(c => c.toLowerCase()))
  })

  it('le thème clair de globals.css vaut RAMPE_SEQUENTIELLE.light, token par token', () => {
    const bloc = blocPorteurDeTokens('html.light')
    const lus = ORDRE_TOKENS.map(nom => hexDuToken(bloc, nom))
    expect(lus).toEqual(RAMPE_SEQUENTIELLE.light.map(c => c.toLowerCase()))
  })

  it('aucun token séquentiel ne manque dans l un des deux blocs', () => {
    for (const selecteur of [':root', 'html.light']) {
      const bloc = blocPorteurDeTokens(selecteur)
      const manquants = ORDRE_TOKENS.filter(nom => hexDuToken(bloc, nom) === null)
      expect(manquants, `tokens absents de « ${selecteur} »`).toEqual([])
    }
  })
})
