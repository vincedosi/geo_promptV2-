import { MAILLES, VUES, TRIS, type CampagneSession, type Maille, type VueCampagne, type Tri } from './session-types'
import type { MagelianTab } from '@/components/magelian/deep-link'

const ONGLETS: readonly MagelianTab[] = ['strategie', 'activation', 'suivi', 'apercu']

export const SESSION_DEFAUT: CampagneSession = {
  campaignId: null, vue: 'suivi', onglet: 'suivi', maille: 'departement',
  parent: null, uniteSelectionnee: null, tri: 'pire', acteurs: [],
}

/**
 * Sérialise la session. Les valeurs par défaut sont OMISES : une URL partagée
 * ne doit pas transporter du bruit, et un paramètre absent se relit comme
 * « valeur par défaut », jamais comme « valeur perdue ».
 */
export function sessionVersUrl(s: CampagneSession): URLSearchParams {
  const p = new URLSearchParams()
  if (s.campaignId) p.set('campagne', s.campaignId)
  if (s.vue !== SESSION_DEFAUT.vue) p.set('vue', s.vue)
  if (s.onglet !== SESSION_DEFAUT.onglet) p.set('onglet', s.onglet)
  if (s.maille !== SESSION_DEFAUT.maille) p.set('maille', s.maille)
  if (s.parent) p.set('parent', s.parent)
  if (s.uniteSelectionnee) p.set('unite', s.uniteSelectionnee)
  if (s.tri !== SESSION_DEFAUT.tri) p.set('tri', s.tri)
  if (s.acteurs.length > 0) p.set('acteurs', s.acteurs.join(','))
  return p
}

function dansListe<T extends string>(v: string | null, liste: readonly T[]): T | undefined {
  return v !== null && (liste as readonly string[]).includes(v) ? (v as T) : undefined
}

/**
 * Relit une session depuis l'URL. Toute valeur inconnue est IGNORÉE plutôt que
 * propagée : une maille « canton » venue d'un lien périmé ne doit pas traverser
 * la frontière et faire échouer une requête plus loin.
 */
export function urlVersSession(p: URLSearchParams): CampagneSession {
  const out: Partial<CampagneSession> = {}

  const campagne = p.get('campagne')
  if (campagne) out.campaignId = campagne

  const vue = dansListe<VueCampagne>(p.get('vue'), VUES)
  if (vue) out.vue = vue
  else if (p.has('vue')) out.vue = undefined // explicite mais invalide

  // `creation` est un ALIAS HÉRITÉ, pas une valeur invalide : le traiter comme
  // invalide perdrait silencieusement les campagnes ouvertes par un ancien lien.
  const ongletBrut = p.get('onglet')
  const onglet = ongletBrut === 'creation' ? 'strategie' : dansListe<MagelianTab>(ongletBrut, ONGLETS)
  if (onglet) out.onglet = onglet
  else if (p.has('onglet')) out.onglet = undefined // explicite mais invalide

  const maille = dansListe<Maille>(p.get('maille'), MAILLES)
  if (maille) out.maille = maille
  else if (p.has('maille')) out.maille = undefined // explicite mais invalide

  // Un parent sans maille explicite n'a pas de sens : on ne sait pas de quel
  // niveau il est le parent. On le laisse tomber plutôt que de deviner.
  const parent = p.get('parent')
  if (parent && maille) out.parent = parent

  const unite = p.get('unite')
  if (unite) out.uniteSelectionnee = unite

  const tri = dansListe<Tri>(p.get('tri'), TRIS)
  if (tri) out.tri = tri
  else if (p.has('tri')) out.tri = undefined // explicite mais invalide

  const acteurs = p.get('acteurs')
  if (acteurs) out.acteurs = acteurs.split(',').map(a => a.trim()).filter(Boolean)

  // Retourner une session complète en fusionnant avec les défauts
  // Les champs présents dans out (même si undefined) prennent leur valeur de out
  // Les champs absents de out prennent leur défaut
  const result: CampagneSession = { ...SESSION_DEFAUT }

  if ('campaignId' in out) result.campaignId = out.campaignId ?? SESSION_DEFAUT.campaignId
  if ('vue' in out) result.vue = out.vue ?? SESSION_DEFAUT.vue
  if ('onglet' in out) result.onglet = out.onglet!
  if ('maille' in out) result.maille = out.maille!
  if ('parent' in out) result.parent = out.parent!
  if ('uniteSelectionnee' in out) result.uniteSelectionnee = out.uniteSelectionnee ?? SESSION_DEFAUT.uniteSelectionnee
  if ('tri' in out) result.tri = out.tri!
  if ('acteurs' in out) result.acteurs = out.acteurs ?? SESSION_DEFAUT.acteurs

  // Si parent n'est pas dans out (car condition maille non satisfaite), le rendre undefined
  if (!('parent' in out)) result.parent = undefined as any

  return result
}
