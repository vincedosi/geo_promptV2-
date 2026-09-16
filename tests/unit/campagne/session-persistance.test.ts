import { describe, it, expect } from 'vitest'
import { fusionnerSession, CLE_SESSION_STORAGE, doitLireUrl } from '@/lib/campagne/CampagneSessionContext'
import { SESSION_DEFAUT, sessionDepuisObjet, sessionVersUrl } from '@/lib/campagne/session-url'

describe('reprise de session', () => {
  it('l URL prime sur le storage — un lien partagé doit ouvrir ce qu il annonce', () => {
    const stockee = { ...SESSION_DEFAUT, campaignId: 'ancienne', maille: 'cp' as const }
    const url = new URLSearchParams('campagne=nouvelle&maille=region')
    const s = fusionnerSession(stockee, url)
    expect(s.campaignId).toBe('nouvelle')
    expect(s.maille).toBe('region')
  })

  it('reprend le storage quand l URL est muette', () => {
    const stockee = { ...SESSION_DEFAUT, campaignId: 'ancienne', tri: 'meilleur' as const }
    expect(fusionnerSession(stockee, new URLSearchParams()).tri).toBe('meilleur')
  })

  it('tombe sur les défauts si le storage est illisible', () => {
    expect(fusionnerSession(null, new URLSearchParams())).toEqual(SESSION_DEFAUT)
  })

  it('la clé de storage est stable — la changer perdrait les sessions en cours', () => {
    expect(CLE_SESSION_STORAGE).toBe('magelian-campagne-session')
  })
})

describe('périmètre de la session', () => {
  it('ne vit que sur la carte', () => {
    expect(doitLireUrl('/map')).toBe(true)
  })

  it('ignore toute autre page — un ?vue= ailleurs ne doit pas muter la session', () => {
    expect(doitLireUrl('/dashboard')).toBe(false)
    expect(doitLireUrl('/admin/health')).toBe(false)
    expect(doitLireUrl('/')).toBe(false)
  })

  it('ne se laisse pas avoir par un préfixe', () => {
    expect(doitLireUrl('/map-ancien')).toBe(false)
  })
})

// ── La frontière STORAGE est gardée comme l'est déjà la frontière URL ──────
// Elle ne l'était pas : `JSON.parse(brut) as CampagneSession` est un cast, donc
// aucune vérification, alors que `urlVersSession` valide scrupuleusement chaque
// champ. `fusionnerSession` étalait ensuite l'objet stocké par-dessus les
// défauts sans filtre. Les deux scénarios ci-dessous sont atteignables par un
// geste ordinaire : une entrée laissée par une version antérieure, ou un
// storage édité à la main.
describe('validation du storage (sessionDepuisObjet)', () => {
  it('rejette une maille inconnue plutôt que de la laisser atteindre la base', () => {
    // `{"maille":"canton"}` faisait lever `alignement_par_maille`
    // (« maille inconnue: canton ») : l'onglet Suivi en erreur à CHAQUE
    // ouverture, sans aucun moyen de s'en sortir depuis l'interface.
    expect(sessionDepuisObjet({ maille: 'canton' })).toEqual({})
    expect(fusionnerSession(sessionDepuisObjet({ maille: 'canton' }), new URLSearchParams()).maille)
      .toBe(SESSION_DEFAUT.maille)
  })

  it('ne laisse jamais `acteurs` être autre chose qu un tableau de chaînes', () => {
    // `{"acteurs":null}` faisait lire `s.acteurs.length` à `sessionVersUrl`,
    // soit un TypeError au montage du provider qui enveloppe TOUTE l'app.
    for (const aberrant of [null, 'dv360', 42, {}]) {
      const s = fusionnerSession(sessionDepuisObjet({ acteurs: aberrant }), new URLSearchParams())
      expect(Array.isArray(s.acteurs)).toBe(true)
      expect(() => sessionVersUrl(s)).not.toThrow()
    }
    expect(sessionDepuisObjet({ acteurs: ['dv360', 42, '', 'tiktok'] }).acteurs)
      .toEqual(['dv360', 'tiktok'])
  })

  it('ne jette sur aucune forme aberrante et rend toujours un objet', () => {
    for (const a of [null, undefined, 42, 'texte', [], [1, 2]]) {
      expect(sessionDepuisObjet(a)).toEqual({})
    }
  })

  it('conserve les valeurs VALIDES, sans rien deviner pour les autres', () => {
    expect(sessionDepuisObjet({
      campaignId: 'abc', vue: 'carte', maille: 'cp', parent: '13',
      tri: 'meilleur', uniteSelectionnee: '13001', acteurs: ['dv360'],
    })).toEqual({
      campaignId: 'abc', vue: 'carte', maille: 'cp', parent: '13',
      tri: 'meilleur', uniteSelectionnee: '13001', acteurs: ['dv360'],
    })
  })

  it('jette un parent orphelin — même règle que l URL : sans maille, on ne sait pas de quel niveau il est', () => {
    expect(sessionDepuisObjet({ parent: '13' }).parent).toBeUndefined()
    expect(sessionDepuisObjet({ parent: '13', maille: 'canton' }).parent).toBeUndefined()
    expect(sessionDepuisObjet({ parent: '13', maille: 'cp' }).parent).toBe('13')
  })

  it('accepte l alias hérité `creation` sur l onglet, comme le fait l URL', () => {
    expect(sessionDepuisObjet({ onglet: 'creation' }).onglet).toBe('strategie')
  })

  it('l aller-retour d une session valide est neutre', () => {
    const s = { ...SESSION_DEFAUT, campaignId: 'c1', maille: 'cp' as const, parent: '13', acteurs: ['dv360'] }
    expect(fusionnerSession(sessionDepuisObjet(JSON.parse(JSON.stringify(s))), new URLSearchParams()))
      .toEqual(s)
  })
})
