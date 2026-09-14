import { MAILLES, VUES, TRIS, type CampagneSession, type Maille, type VueCampagne, type Tri } from './session-types'
import { TABS, ALIAS_TAB, type MagelianTab } from '@/components/magelian/deep-link'

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
  // `maille` est émise dès qu'un `parent` l'accompagne, MÊME si c'est la
  // valeur par défaut : un parent doit toujours voyager avec son niveau.
  // Sans cette exception, un fil d'Ariane posé à la maille par défaut se
  // sérialise en `parent=11` sans maille, et la relecture le jette — le
  // lien partagé perd silencieusement la position de l'utilisateur.
  if (s.maille !== SESSION_DEFAUT.maille || s.parent) p.set('maille', s.maille)
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
export function urlVersSession(p: URLSearchParams): Partial<CampagneSession> {
  const out: Partial<CampagneSession> = {}

  const campagne = p.get('campagne')
  if (campagne) out.campaignId = campagne

  const vue = dansListe<VueCampagne>(p.get('vue'), VUES)
  if (vue) out.vue = vue

  // `creation` est un ALIAS HÉRITÉ, pas une valeur invalide : le traiter comme
  // invalide perdrait silencieusement les campagnes ouvertes par un ancien lien.
  const ongletBrut = p.get('onglet')
  const onglet = ALIAS_TAB[ongletBrut || ''] || dansListe<MagelianTab>(ongletBrut, TABS)
  if (onglet) out.onglet = onglet

  const maille = dansListe<Maille>(p.get('maille'), MAILLES)
  if (maille) out.maille = maille

  // Un parent sans maille explicite n'a pas de sens : on ne sait pas de quel
  // niveau il est le parent. On le laisse tomber plutôt que de deviner.
  const parent = p.get('parent')
  if (parent && maille) out.parent = parent

  const unite = p.get('unite')
  if (unite) out.uniteSelectionnee = unite

  const tri = dansListe<Tri>(p.get('tri'), TRIS)
  if (tri) out.tri = tri

  const acteurs = p.get('acteurs')
  if (acteurs) out.acteurs = acteurs.split(',').map(a => a.trim()).filter(Boolean)

  return out
}
