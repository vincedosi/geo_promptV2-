import type { MagelianTab } from '@/components/magelian/deep-link'

/** Mailles d'affichage. Le SCORE est toujours calculé au CP, quelle que soit celle-ci. */
export const MAILLES = ['region', 'departement', 'cp'] as const
export type Maille = (typeof MAILLES)[number]

export const VUES = ['suivi', 'carte'] as const
export type VueCampagne = (typeof VUES)[number]

export const TRIS = ['pire', 'meilleur'] as const
export type Tri = (typeof TRIS)[number]

export interface CampagneSession {
  campaignId: string | null
  vue: VueCampagne
  onglet: MagelianTab
  maille: Maille
  /** Code du parent dans le fil d'Ariane (code région ou département). null = France entière. */
  parent: string | null
  /** Unité mise en évidence (code région / département / CP). */
  uniteSelectionnee: string | null
  tri: Tri
  /** [] = tous les acteurs. Ne filtre JAMAIS le score, seulement le reste de l'écran. */
  acteurs: string[]
}
