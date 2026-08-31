/**
 * MAGELIAN — utilitaires transverses.
 *
 * `cn()` fusionne des listes de classes Tailwind conditionnelles : clsx
 * resout les conditions, twMerge arbitre les conflits (la derniere classe
 * d'une meme famille gagne). A utiliser partout plutot qu'une concatenation
 * manuelle, sans quoi `p-2 p-4` produirait deux classes concurrentes.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
