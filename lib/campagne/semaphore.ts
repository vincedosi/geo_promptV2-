/**
 * Sémaphore générique — borne le nombre d'opérations asynchrones réellement
 * EN VOL en même temps, quel que soit l'ordre dans lequel les effets React
 * qui les déclenchent s'exécutent.
 *
 * Existe parce qu'une garde posée sur une DÉPENDANCE D'ÉTAT React (« ne
 * fetch pas si `chargement` vaut déjà `true` ») est sujette à une course :
 * `setChargement(true)` appelé au début d'un effet ne devient visible aux
 * AUTRES effets du MÊME commit qu'au rendu SUIVANT — deux effets déclenchés
 * par le même changement de dépendances (ex. un changement de campagne) lisent
 * donc tous les deux l'ANCIENNE valeur de `chargement` et démarrent leur fetch
 * en même temps (Ruling T15-1, relecture Tâche 15 : la garde par dépendance
 * seule ne suffisait pas). Un compteur incrémenté/décrémenté de façon
 * SYNCHRONE (`acquerir`/la fonction de libération qu'il rend) n'a pas ce
 * problème : la file d'attente est vraie, pas dérivée d'un rendu.
 *
 * Usage :
 *   const sem = creerSemaphore(3)
 *   const liberer = await sem.acquerir()
 *   try { await fetch(...) } finally { liberer() }
 */
export interface Semaphore {
  /** Résout dès qu'une place est libre (immédiatement si `max` n'est pas
   *  atteint), avec la fonction à appeler pour rendre la place. */
  acquerir(): Promise<() => void>
  /** Nombre d'opérations actuellement en vol — pour le comptage/rapport, jamais pour décider d'une garde (utiliser `acquerir`). */
  enVol(): number
}

export function creerSemaphore(max: number): Semaphore {
  let actifs = 0
  const attente: (() => void)[] = []

  /**
   * Un JETON PAR ACQUISITION, et non une fermeture unique partagée par tous
   * les acquéreurs.
   *
   * La version précédente rendait la MÊME fonction `liberer` à tout le monde.
   * Un appelant qui l'aurait déclenchée deux fois — double `finally`,
   * `finally` plus gestionnaire d'annulation — décrémentait `actifs` deux fois
   * et dépilait deux attentes : le plafond de 3 passait durablement à 4, 5…
   * sans jamais redescendre, ce qui rouvre exactement la règle non négociable
   * de CLAUDE.md que ce module existe pour tenir (« `Promise.all()` > 3 appels
   * Supabase simultanés »).
   *
   * Aucun chemin actuel ne libère deux fois — les quatre sites appellent une
   * fois dans un `finally` placé après le `await` du travail — mais c'était
   * une garantie tenue par convention, pas par construction. Le drapeau la
   * rend structurelle : une libération en trop ne fait rien.
   */
  function jeton(): () => void {
    let libere = false
    return function liberer(): void {
      if (libere) return
      libere = true
      actifs--
      const suivant = attente.shift()
      if (suivant) {
        actifs++
        suivant()
      }
    }
  }

  function acquerir(): Promise<() => void> {
    return new Promise((resolve) => {
      if (actifs < max) {
        actifs++
        resolve(jeton())
      } else {
        attente.push(() => resolve(jeton()))
      }
    })
  }

  return { acquerir, enVol: () => actifs }
}
