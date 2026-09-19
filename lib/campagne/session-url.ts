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
/**
 * Les clés que la session de campagne POSSÈDE dans l'URL.
 *
 * ⚠ Elle n'en possède pas d'autres, et la distinction n'est pas théorique.
 * `/map` est une page partagée : l'analyse de population à risque y écrit
 * `risque=`, et d'autres écrans en écriront demain. La persistance de session
 * écrasait la chaîne de requête ENTIÈRE — un `router.replace('/map?' + qs)` qui
 * reconstruit tout — et faisait donc disparaître les paramètres des voisins à
 * la première bascule de vue, sans erreur ni trace.
 *
 * Constaté le 2026-09-19 : ouvrir `/map?risque=onglet%3Ddiffusion` aboutissait
 * à `/map?campagne=…&maille=cp&parent=13&unite=13104`. Le lien partagé perdait
 * exactement ce qu'il transportait.
 */
export const CLES_SESSION = [
  'campagne', 'vue', 'onglet', 'maille', 'parent', 'unite', 'tri', 'acteurs',
] as const;

/**
 * Fusionne les paramètres de session dans une chaîne de requête EXISTANTE.
 *
 * Les clés de la session sont remplacées, toutes les autres sont conservées
 * telles quelles. C'est ce qui permet à plusieurs écrans de cohabiter dans la
 * même URL sans se marcher dessus.
 *
 * @param s - La session à sérialiser.
 * @param actuels - Les paramètres présents dans l'URL, souvent ceux du voisin.
 * @returns Les paramètres fusionnés.
 *
 * @example
 * fusionnerUrlSession(session, new URLSearchParams('risque=onglet%3Drayons'))
 * // → 'risque=onglet%3Drayons&campagne=…'  — le voisin survit
 */
export function fusionnerUrlSession(
  s: CampagneSession,
  actuels: URLSearchParams,
): URLSearchParams {
  const sortie = new URLSearchParams(actuels)
  for (const cle of CLES_SESSION) sortie.delete(cle)
  for (const [cle, valeur] of sessionVersUrl(s)) sortie.set(cle, valeur)
  return sortie
}

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

/** Une chaîne non vide, ou `null` — pour les champs libres (codes, identifiants). */
function chaine(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Relit une session depuis un objet QUELCONQUE — le `JSON.parse` du
 * localStorage, et rien d'autre à ce jour.
 *
 * Existe parce que les deux frontières d'entrée de la session n'étaient pas
 * gardées pareil : `urlVersSession` validait scrupuleusement chaque champ
 * contre `MAILLES`/`VUES`/`TRIS`, tandis que le storage était relu par un
 * `JSON.parse(brut) as CampagneSession` — un cast, donc aucune vérification.
 * `fusionnerSession` étalait ensuite l'objet stocké par-dessus les défauts
 * sans filtre. Deux conséquences atteignables par un geste ordinaire :
 *
 * - `{"maille":"canton"}` (entrée d'une version antérieure, ou éditée à la
 *   main) traversait jusqu'à `alignement_par_maille`, qui lève
 *   `maille inconnue: canton` — l'onglet Suivi en erreur à CHAQUE ouverture,
 *   sans aucun moyen de s'en sortir depuis l'interface.
 * - `{"acteurs":null}` faisait lire `s.acteurs.length` à `sessionVersUrl`,
 *   soit un `TypeError` au montage du provider qui enveloppe TOUTE
 *   l'application (`app/layout.tsx`).
 *
 * Même règle que l'URL : toute valeur inconnue est IGNORÉE (la clé n'est pas
 * émise), jamais propagée ni remplacée par une valeur devinée — l'absence se
 * relit comme « valeur par défaut ».
 */
export function sessionDepuisObjet(brut: unknown): Partial<CampagneSession> {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return {}
  const o = brut as Record<string, unknown>
  const out: Partial<CampagneSession> = {}

  const campaignId = chaine(o.campaignId)
  if (campaignId) out.campaignId = campaignId

  const vue = dansListe<VueCampagne>(chaine(o.vue), VUES)
  if (vue) out.vue = vue

  // Même alias hérité que l'URL : `creation` ouvre l'onglet Stratégie.
  const ongletBrut = chaine(o.onglet)
  const onglet = ALIAS_TAB[ongletBrut ?? ''] || dansListe<MagelianTab>(ongletBrut, TABS)
  if (onglet) out.onglet = onglet

  const maille = dansListe<Maille>(chaine(o.maille), MAILLES)
  if (maille) out.maille = maille

  // Un parent sans maille valide n'a pas de sens : on ne sait pas de quel
  // niveau il est le parent. Même règle que l'URL.
  const parent = chaine(o.parent)
  if (parent && maille) out.parent = parent

  const unite = chaine(o.uniteSelectionnee)
  if (unite) out.uniteSelectionnee = unite

  const tri = dansListe<Tri>(chaine(o.tri), TRIS)
  if (tri) out.tri = tri

  // `acteurs` DOIT rester un tableau de chaînes : `sessionVersUrl` lit
  // `s.acteurs.length` sans garde, et `null` y lèverait.
  if (Array.isArray(o.acteurs)) {
    out.acteurs = o.acteurs.filter((a): a is string => typeof a === 'string' && a.length > 0)
  }

  return out
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
