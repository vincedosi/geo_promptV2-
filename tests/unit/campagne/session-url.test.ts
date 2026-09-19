import { describe, it, expect } from 'vitest'
import { sessionVersUrl, urlVersSession, SESSION_DEFAUT } from '@/lib/campagne/session-url'
import type { CampagneSession } from '@/lib/campagne/session-types'

const SESSION: CampagneSession = {
  campaignId: 'dccc0000-0000-4000-8000-000000000002',
  vue: 'carte',
  onglet: 'suivi',
  maille: 'departement',
  parent: '11',
  uniteSelectionnee: '13',
  tri: 'pire',
  acteurs: ['dv360', 'tiktok'],
}

describe('sérialisation de la session campagne', () => {
  it('fait un aller-retour sans perte, une fois fusionné avec les défauts', () => {
    // `urlVersSession` rend un Partial : ce qu'il n'a PAS lu doit rester absent,
    // sinon Task 2 ne pourrait plus distinguer « l'URL est muette » de « l'URL
    // impose la valeur par défaut » et écraserait la session reprise du storage.
    // La propriété à vérifier n'est donc pas l'égalité brute, mais l'absence de
    // PERTE : fusionné aux défauts, on retrouve exactement la session de départ.
    const params = sessionVersUrl(SESSION)
    expect({ ...SESSION_DEFAUT, ...urlVersSession(params) }).toEqual(SESSION)
  })

  it('omet les valeurs par défaut pour garder une URL courte', () => {
    const params = sessionVersUrl({ ...SESSION_DEFAUT, campaignId: 'abc' })
    expect(params.toString()).toBe('campagne=abc')
  })

  it('ignore une maille inconnue plutôt que de la propager', () => {
    const p = new URLSearchParams('campagne=abc&maille=canton')
    expect(urlVersSession(p).maille).toBeUndefined()
  })

  it('ignore un onglet inconnu mais accepte l alias hérité creation', () => {
    expect(urlVersSession(new URLSearchParams('onglet=creation')).onglet).toBe('strategie')
    expect(urlVersSession(new URLSearchParams('onglet=zzz')).onglet).toBeUndefined()
  })

  it('ne rend jamais un parent sans maille — un fil d Ariane orphelin est ininterprétable', () => {
    const p = new URLSearchParams('campagne=abc&parent=11')
    expect(urlVersSession(p).parent).toBeUndefined()
  })
})
