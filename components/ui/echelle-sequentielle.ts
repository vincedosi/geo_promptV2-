/**
 * Échelle SÉQUENTIELLE du DESIGN_SYSTEM (§3), en jetons CSS.
 *
 * Contrepartie DOM de `lib/campagne/palette-sequentielle.ts`, qui porte les
 * mêmes couleurs en hex littéraux parce que MapLibre ne résout pas `var()`
 * dans un bloc `paint`. Partout ailleurs — barres, légendes, pastilles — c'est
 * CE tableau qu'on peint, jamais un hex ni un `linear-gradient` (règle globale
 * #10 du DESIGN_SYSTEM : « pas de glow, shadow, gradient, blur — flat total »).
 *
 * À n'utiliser que pour une grandeur MONOTONE : une intensité croissante sans
 * signe, du plus faible au plus fort. Un écart au plan — qui a un centre
 * neutre et deux sens — relève de l'échelle DIVERGENTE
 * (`lib/campagne/palette-divergente.ts`), et l'y confondre fait signifier
 * « bon » au bleu, qui signifie « sur-pression » partout ailleurs.
 */
export const PALIERS_SEQUENTIELS_CSS = [
  'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)',
] as const;
