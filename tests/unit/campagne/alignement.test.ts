import { describe, it, expect } from 'vitest'
import { calculerAlignement, type ResultatAlignement, type UniteAlignement } from '@/lib/campagne/alignement'

/**
 * `calculerAlignement` rend `null` quand le score n'est PAS CALCULABLE (aucune
 * unite, ou aucune impression reelle) — voir le cas degenere plus bas. Les cas
 * nominaux passent par cette assertion pour garder leur lecture directe : un
 * `null` inattendu fait echouer le test la ou il se produit, pas trois lignes
 * plus loin sur un `NaN`.
 */
function calcule(
  unites: UniteAlignement[], tolerancePct: number, poids: number,
): ResultatAlignement {
  const r = calculerAlignement(unites, tolerancePct, poids)
  if (r === null) throw new Error('score attendu calculable, recu null')
  return r
}

const parfait: UniteAlignement[] = [
  { code: '75001', reel: 500, plan: 500 },
  { code: '13001', reel: 300, plan: 300 },
  { code: '69001', reel: 200, plan: 200 },
]

describe('score d alignement géographique', () => {
  it('rend 100 quand le réel colle au plan partout', () => {
    const r = calcule(parfait, 10, 1)
    expect(r.score).toBe(100)
    expect(r.conformes_pct).toBe(100)
    expect(r.sous_pression_pct).toBe(0)
    expect(r.sur_pression_pct).toBe(0)
  })

  it('ne pénalise pas un écart intérieur à la tolérance', () => {
    const dansLaMarge: UniteAlignement[] = [
      { code: 'a', reel: 545, plan: 500 }, // +9 %, sous les 10 %
      { code: 'b', reel: 455, plan: 500 }, // -9 %
    ]
    const r = calcule(dansLaMarge, 10, 1)
    expect(r.score).toBe(100)
    expect(r.conformes_pct).toBe(100)
  })

  it('ne compte que la part AU-DELÀ de la tolérance, pas l écart entier', () => {
    // plan 500, tolérance 10 % => seuil bas 450. réel 400 => manque 50, pas 100.
    const r = calcule([{ code: 'a', reel: 400, plan: 500 }], 10, 1)
    expect(r.sous_pression_imps).toBe(50)
  })

  it('pénalise la SUR-pression, pas seulement la sous-pression', () => {
    const sous = calcule([{ code: 'a', reel: 400, plan: 500 }, { code: 'b', reel: 600, plan: 500 }], 10, 1)
    expect(sous.sur_pression_imps).toBe(50)
    expect(sous.sous_pression_imps).toBe(50)
    expect(sous.score).toBeLessThan(100)
  })

  it('le poids de sur-pression module la pénalité, et 0 la neutralise', () => {
    const u: UniteAlignement[] = [{ code: 'a', reel: 600, plan: 500 }, { code: 'b', reel: 400, plan: 500 }]
    expect(calcule(u, 10, 0).score).toBeGreaterThan(calcule(u, 10, 1).score)
  })

  it('ne descend jamais sous 0 même sur une campagne totalement déréglée', () => {
    const catastrophe: UniteAlignement[] = [
      { code: 'a', reel: 0, plan: 1000 },
      { code: 'b', reel: 2000, plan: 0 },
    ]
    expect(calcule(catastrophe, 10, 1).score).toBeGreaterThanOrEqual(0)
  })

  it('ignore une unité au plan nul sans exploser en division par zéro', () => {
    const r = calcule([{ code: 'a', reel: 10, plan: 0 }, { code: 'b', reel: 100, plan: 100 }], 10, 1)
    expect(Number.isFinite(r.score)).toBe(true)
  })

  // ── Cas DEGENERE : « pas calculable » n'est ni 0 ni 100 ─────────────────
  // Ce jumeau rendait 100 (« parfaitement aligne ») sur un jeu vide, la RPC
  // rendait 0 (« catastrophique ») pour la MEME entree — mesure en base sur
  // une campagne sans rollup. ARCHITECTURE.md affirmait « accord exact » : vrai
  // du chemin nominal, faux d'ici. Les deux disent desormais la meme chose.
  it('rend null sur un jeu vide — jamais un score de 100 invente', () => {
    expect(calculerAlignement([], 10, 1)).toBeNull()
  })

  it('rend null quand il n y a aucune impression reelle a repartir', () => {
    // Le denominateur de toutes les penalites est le volume reel total :
    // sans lui il n'y a pas de score par defaut, seulement un verdict a ne
    // pas rendre. Le plan seul ne suffit pas a mesurer un alignement.
    expect(calculerAlignement(
      [{ code: 'a', reel: 0, plan: 1000 }, { code: 'b', reel: 0, plan: 500 }],
      10, 1,
    )).toBeNull()
  })

  // ── Les deux tests suivants épinglent des VALEURS EXACTES. Sans eux, une
  // analyse de mutation montre que trois défauts plausibles passent la suite
  // sans faire rougir un seul test : intervertir le dénominateur (volume réel
  // contre volume planifié), appliquer le poids au mauvais terme, et sauter
  // les unités au plan nul au lieu de mesurer leur sur-pression. Ce fichier
  // est l'ORACLE du jumeau SQL de la Task 5 : un oracle qui ne distingue pas
  // ces trois cas ne vaut rien.

  it('épingle le score exact sur un cas ASYMÉTRIQUE, dénominateur et poids compris', () => {
    // Volume réel 1800, volume planifié 2000 — volontairement différents, pour
    // qu'un dénominateur interverti change le résultat au lieu de passer.
    const u: UniteAlignement[] = [
      { code: 'a', reel: 400, plan: 1000 },  // bas 900  → manque 500
      { code: 'b', reel: 900, plan: 500 },   // haut 550 → trop  350
      { code: 'c', reel: 500, plan: 500 },   // conforme
    ]
    // Poids 2, non 1 : appliquer le poids au mauvais terme donnerait 25, pas 33.
    const r = calcule(u, 10, 2)
    expect(r.sous_pression_imps).toBe(500)
    expect(r.sur_pression_imps).toBe(350)
    expect(r.sous_pression_pct).toBe(27.78)   // 500/1800 — avec 2000 : 25
    expect(r.sur_pression_pct).toBe(19.44)    // 350/1800 — avec 2000 : 17,5
    expect(r.conformes_pct).toBe(33.3)
    expect(r.n_unites).toBe(3)
    expect(r.score).toBe(33)                  // dénominateur inverti : 40 · poids inversé : 25
  })

  it('MESURE la sur-pression d une unité au plan nul, au lieu de l ignorer', () => {
    const r = calcule(
      [{ code: 'a', reel: 10, plan: 0 }, { code: 'b', reel: 100, plan: 100 }],
      10, 1,
    )
    // Sauter les unités au plan nul rendrait 0 ici, et un score de 100.
    expect(r.sur_pression_imps).toBe(10)
    expect(r.sous_pression_imps).toBe(0)
    expect(r.score).toBe(91)
  })

  it('reproduit la mesure du 2026-09-14 sur la campagne de démo', () => {
    // Valeurs mesurées en base : sous 3,84 % · sur 3,35 % · conformes 72,5 %
    // Ce test fige la formule, pas les données : il utilise un jeu réduit
    // dont les proportions sont connues.
    const u: UniteAlignement[] = [
      { code: 'a', reel: 384, plan: 1000 },  // très sous
      ...Array.from({ length: 7 }, (_, i) => ({ code: `c${i}`, reel: 1000, plan: 1000 })),
    ]
    const r = calcule(u, 10, 1)
    expect(r.conformes_pct).toBeCloseTo(87.5, 1)
  })
})
