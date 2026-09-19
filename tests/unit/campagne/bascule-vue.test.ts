import { describe, it, expect } from 'vitest'
import { SESSION_DEFAUT } from '@/lib/campagne/session-url'
import { appliquerBascule, appliquerChangementCampagne } from '@/lib/campagne/transitions'

describe('bascule entre carte et suivi', () => {
  it('ne change QUE la vue — maille, fil d Ariane, tri et sélection survivent', () => {
    const avant = {
      ...SESSION_DEFAUT, campaignId: 'a', vue: 'suivi' as const,
      maille: 'cp' as const, parent: '13', uniteSelectionnee: '13001', tri: 'meilleur' as const,
    }
    const apres = appliquerBascule(avant)
    expect(apres.vue).toBe('carte')
    expect({ ...apres, vue: avant.vue }).toEqual(avant)
  })

  it('revient exactement au même état au second aller-retour', () => {
    const s = { ...SESSION_DEFAUT, campaignId: 'a', maille: 'region' as const, parent: null }
    expect(appliquerBascule(appliquerBascule(s))).toEqual(s)
  })

  it('changer de campagne CONSERVE la vue courante', () => {
    const s = { ...SESSION_DEFAUT, campaignId: 'a', vue: 'carte' as const, maille: 'cp' as const }
    expect(appliquerChangementCampagne(s, 'b').vue).toBe('carte')
  })

  it('changer de campagne remet à zéro le fil d Ariane et la sélection', () => {
    // Un département sélectionné dans la campagne A n'a aucune raison d'être
    // pertinent dans la campagne B — et il peut n'y exister aucune donnée.
    const s = { ...SESSION_DEFAUT, campaignId: 'a', parent: '11', uniteSelectionnee: '75' }
    const apres = appliquerChangementCampagne(s, 'b')
    expect(apres.parent).toBeNull()
    expect(apres.uniteSelectionnee).toBeNull()
  })

  it('changer de campagne conserve la MAILLE — c est une préférence de lecture', () => {
    const s = { ...SESSION_DEFAUT, campaignId: 'a', maille: 'region' as const }
    expect(appliquerChangementCampagne(s, 'b').maille).toBe('region')
  })
})
