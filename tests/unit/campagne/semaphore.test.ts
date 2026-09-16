import { describe, it, expect } from 'vitest'
import { creerSemaphore } from '@/lib/campagne/semaphore'

describe('creerSemaphore', () => {
  it('laisse passer jusqu à `max` opérations sans attendre', async () => {
    const sem = creerSemaphore(3)
    const liberations = await Promise.all([sem.acquerir(), sem.acquerir(), sem.acquerir()])
    expect(sem.enVol()).toBe(3)
    liberations.forEach((l) => l())
    expect(sem.enVol()).toBe(0)
  })

  it('ne dépasse jamais `max` en vol simultanément, même avec plus de demandeurs', async () => {
    const sem = creerSemaphore(3)
    let pic = 0
    const enCours = new Set<number>()

    async function tache(id: number): Promise<void> {
      const liberer = await sem.acquerir()
      enCours.add(id)
      pic = Math.max(pic, enCours.size)
      // cède la main pour laisser d'autres tâches essayer de démarrer pendant celle-ci
      await new Promise((r) => setTimeout(r, 1))
      enCours.delete(id)
      liberer()
    }

    await Promise.all(Array.from({ length: 10 }, (_, i) => tache(i)))
    expect(pic).toBeLessThanOrEqual(3)
  })

  it('la libération sert la file dans l ordre (FIFO)', async () => {
    const sem = creerSemaphore(1)
    const ordre: number[] = []
    const l1 = await sem.acquerir()
    const p2 = sem.acquerir().then((l) => { ordre.push(2); return l })
    const p3 = sem.acquerir().then((l) => { ordre.push(3); return l })
    // Rien ne peut avancer tant que la première place n'est pas rendue.
    expect(ordre).toEqual([])
    l1()
    const l2 = await p2
    expect(ordre).toEqual([2])
    l2()
    await p3
    expect(ordre).toEqual([2, 3])
  })

  // ── Une libération en trop ne doit pas relever le plafond ────────────────
  // `liberer` était UNE SEULE fermeture rendue à tous les acquéreurs, pas un
  // jeton par acquisition. Un appelant qui l'aurait déclenchée deux fois
  // (double `finally`, `finally` + gestionnaire d'annulation) décrémentait
  // `actifs` deux fois et dépilait deux attentes : le plafond de 3 passait
  // durablement à 4, 5… sans jamais redescendre — exactement la règle non
  // négociable de CLAUDE.md que ce module existe pour tenir.
  it('une libération appelée DEUX FOIS ne compte que pour une', async () => {
    const sem = creerSemaphore(3)
    const l1 = await sem.acquerir()
    await sem.acquerir()
    expect(sem.enVol()).toBe(2)
    l1()
    l1()
    l1()
    expect(sem.enVol()).toBe(1)
  })

  it('le plafond tient même si CHAQUE tâche libère deux fois', async () => {
    const sem = creerSemaphore(3)
    let pic = 0
    const enCours = new Set<number>()

    async function tache(id: number): Promise<void> {
      const liberer = await sem.acquerir()
      enCours.add(id)
      pic = Math.max(pic, enCours.size)
      await new Promise((r) => setTimeout(r, 1))
      enCours.delete(id)
      liberer()
      liberer() // la libération en trop : sans jeton, elle ouvrait une place de plus
    }

    await Promise.all(Array.from({ length: 12 }, (_, i) => tache(i)))
    expect(pic).toBeLessThanOrEqual(3)
    expect(sem.enVol()).toBe(0)
  })

  it('chaque acquisition rend un jeton DISTINCT', async () => {
    const sem = creerSemaphore(2)
    const a = await sem.acquerir()
    const b = await sem.acquerir()
    expect(a).not.toBe(b)
  })
})
