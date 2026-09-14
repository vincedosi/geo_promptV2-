'use client'
import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SESSION_DEFAUT, sessionVersUrl, urlVersSession } from './session-url'
import type { CampagneSession, VueCampagne } from './session-types'

export const CLE_SESSION_STORAGE = 'magelian-campagne-session'

/**
 * L'URL prime sur le storage. Un lien partagé doit ouvrir EXACTEMENT ce qu'il
 * annonce ; le storage n'est qu'un repli pour le retour dans l'application.
 */
export function fusionnerSession(
  stockee: CampagneSession | null,
  url: URLSearchParams,
): CampagneSession {
  return { ...SESSION_DEFAUT, ...(stockee ?? {}), ...urlVersSession(url) }
}

function lireStorage(): CampagneSession | null {
  try {
    const brut = window.localStorage.getItem(CLE_SESSION_STORAGE)
    return brut ? (JSON.parse(brut) as CampagneSession) : null
  } catch {
    return null // fenêtre privée, storage bloqué : on repart des défauts
  }
}

interface Valeur {
  session: CampagneSession
  majSession: (patch: Partial<CampagneSession>) => void
  basculerVue: () => void
}

const Ctx = createContext<Valeur | null>(null)

/**
 * Lit l'URL et la reverse dans la session. Isolé dans son propre composant
 * parce que `useSearchParams()` impose une frontière Suspense en App Router :
 * ceinturer le provider entier ferait disparaître l'application derrière un
 * fallback (le provider enveloppe `children`, c'est-à-dire toute l'app —
 * voir `app/layout.tsx`). Ici, seul ce composant vide peut suspendre. Même
 * patron que `MagelianDeepLink` (`components/magelian/MagelianDeepLink.tsx`).
 */
function SynchroniseurUrl({ onUrl }: { onUrl: (qs: string) => void }) {
  const searchParams = useSearchParams()
  const qs = searchParams.toString()
  useEffect(() => { onUrl(qs) }, [qs, onUrl])
  return null
}

export function CampagneSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  // Seed synchrone : évite un rendu avec les défauts puis un saut.
  const [session, setSession] = useState<CampagneSession>(() =>
    typeof window === 'undefined'
      ? SESSION_DEFAUT
      : fusionnerSession(lireStorage(), new URLSearchParams(window.location.search)),
  )

  const majSession = useCallback((patch: Partial<CampagneSession>) => {
    setSession(prev => {
      // Changer de maille invalide le fil d'Ariane et la sélection : ils
      // désignent des codes d'un AUTRE niveau. Les garder afficherait un
      // département sélectionné dans une liste de régions.
      const reset = patch.maille && patch.maille !== prev.maille
        ? { parent: null, uniteSelectionnee: null }
        : {}
      return { ...prev, ...reset, ...patch }
    })
  }, [])

  const basculerVue = useCallback(() => {
    setSession(prev => ({ ...prev, vue: prev.vue === 'suivi' ? 'carte' : 'suivi' }))
  }, [])

  // Persistance storage
  useEffect(() => {
    try { window.localStorage.setItem(CLE_SESSION_STORAGE, JSON.stringify(session)) } catch { /* ignoré */ }
  }, [session])

  // Persistance URL — `replace`, jamais `push` : la bascule de vue n'est pas
  // une navigation, elle ne doit pas empiler d'entrée dans l'historique.
  const derniereUrlRef = useRef<string>('')
  useEffect(() => {
    if (pathname !== '/map') return
    const qs = sessionVersUrl(session).toString()
    if (qs === derniereUrlRef.current) return
    derniereUrlRef.current = qs
    router.replace(qs ? `/map?${qs}` : '/map', { scroll: false })
  }, [session, pathname, router])

  // Relecture si l'URL change sous nos pieds (lien collé, bouton retour).
  // Stable à dépendances vides : ne ferme que sur `setSession` (garanti
  // stable par React) et `derniereUrlRef` (une ref) — sinon `onUrl`
  // changerait d'identité à chaque rendu et redéclencherait l'effet de
  // `SynchroniseurUrl` en boucle (piège déjà documenté dans
  // `lib/carte/pile-echap.ts`).
  const relireDepuisUrl = useCallback((qs: string) => {
    if (!qs || qs === derniereUrlRef.current) return
    setSession(prev => ({ ...prev, ...urlVersSession(new URLSearchParams(qs)) }))
  }, [])

  const valeur = useMemo(() => ({ session, majSession, basculerVue }), [session, majSession, basculerVue])
  return (
    <Ctx.Provider value={valeur}>
      <Suspense fallback={null}>
        <SynchroniseurUrl onUrl={relireDepuisUrl} />
      </Suspense>
      {children}
    </Ctx.Provider>
  )
}

export function useCampagneSession(): Valeur {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCampagneSession doit être appelé sous CampagneSessionProvider')
  return v
}

export type { CampagneSession, VueCampagne }
