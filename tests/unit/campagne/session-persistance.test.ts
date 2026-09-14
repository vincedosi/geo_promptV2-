import { describe, it, expect } from 'vitest'
import { fusionnerSession, CLE_SESSION_STORAGE, doitLireUrl } from '@/lib/campagne/CampagneSessionContext'
import { SESSION_DEFAUT } from '@/lib/campagne/session-url'

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
