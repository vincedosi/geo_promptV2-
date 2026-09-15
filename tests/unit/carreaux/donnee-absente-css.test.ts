import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COULEUR_DONNEE_ABSENTE } from '@/lib/carreaux/expressions'

/**
 * `COULEUR_DONNEE_ABSENTE` est un littéral hex légitime dans une expression de
 * `paint` MapLibre (qui ne résout pas `var()`), mais illégitime dans un `style`
 * DOM (règle du DESIGN_SYSTEM : `var(--token)` uniquement). La pastille de
 * légende de `DiffusionMapLayer.tsx` porte donc le token `--donnee-absente`,
 * et rien ne garantit qu'il reste égal au littéral peint sur la carte —
 * jusqu'à ce test, qui lit le VRAI `app/globals.css`. Même patron que
 * `tests/unit/campagne/palette-divergente-css.test.ts`.
 *
 * Différence avec cette dernière : `COULEUR_DONNEE_ABSENTE` est passé tel
 * quel à `expressionEtapes` quel que soit le thème (jamais `RAMPE_MAPLIBRE
 * [theme]`) — la couleur peinte sur la carte NE VARIE PAS avec le thème.
 * Le token est donc volontairement le MÊME dans les deux blocs, comme
 * `--brand-teal` : on verrouille une égalité à trois termes (littéral, bloc
 * sombre, bloc clair), pas une paire de valeurs distinctes par thème.
 */

const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

/**
 * Rend le bloc du sélecteur qui porte réellement le token `--donnee-absente`.
 * `html.light` apparaît plusieurs fois dans globals.css : prendre le premier
 * bloc venu attraperait celui qui ne déclare que `color-scheme`.
 */
function blocPorteurDuToken(selecteur: string): string {
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
  const bloc = blocs.find(b => b.includes('--donnee-absente'))
  if (!bloc) throw new Error(`aucun bloc « ${selecteur} » ne porte --donnee-absente`)
  return bloc
}

function hexDuToken(bloc: string): string | null {
  const m = bloc.match(/--donnee-absente\s*:\s*(#[0-9a-fA-F]{6})\s*;/)
  return m ? m[1].toLowerCase() : null
}

describe('correspondance entre --donnee-absente et COULEUR_DONNEE_ABSENTE', () => {
  it('le bloc :root vaut exactement le littéral MapLibre', () => {
    expect(hexDuToken(blocPorteurDuToken(':root'))).toBe(COULEUR_DONNEE_ABSENTE.toLowerCase())
  })

  it('le bloc html.light vaut exactement le littéral MapLibre', () => {
    expect(hexDuToken(blocPorteurDuToken('html.light'))).toBe(COULEUR_DONNEE_ABSENTE.toLowerCase())
  })

  it('les deux thèmes portent la MÊME valeur — la couleur peinte sur la carte ne varie pas avec le thème', () => {
    const sombre = hexDuToken(blocPorteurDuToken(':root'))
    const clair = hexDuToken(blocPorteurDuToken('html.light'))
    expect(sombre).toBe(clair)
  })
})
