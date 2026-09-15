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

  function liberer(): void {
    actifs--
    const suivant = attente.shift()
    if (suivant) {
      actifs++
      suivant()
    }
  }

  function acquerir(): Promise<() => void> {
    return new Promise((resolve) => {
      if (actifs < max) {
        actifs++
        resolve(liberer)
      } else {
        attente.push(() => resolve(liberer))
      }
    })
  }

  return { acquerir, enVol: () => actifs }
}
