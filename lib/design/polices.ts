/**
 * Les deux familles de police du design system MAGELIAN, déclarées UNE fois.
 *
 * ── POURQUOI CE FICHIER ────────────────────────────────────────────────────
 *
 * `fInter` et `fMono` étaient redéclarés dans chaque composant qui en avait
 * besoin, et les copies avaient DIVERGÉ (constat R-24 de
 * `docs/AUDIT_ZONE_RISQUE.md`) : les trois fichiers de `components/risques/`
 * écrivaient `"'JetBrains Mono', monospace"` là où
 * `app/map/_components/filter-panel/tokens.ts` porte
 * `"'JetBrains Mono','Fira Mono',monospace"`.
 *
 * Le repli `Fira Mono` du design system sautait donc sur tout l'écran
 * d'analyse — sans rien casser, sans rien signaler, et invisible tant qu'on ne
 * compare pas les deux fichiers.
 *
 * `DESIGN_SYSTEM.md` : « Deux fonts max : Inter (UI) + JetBrains Mono
 * (données/code) ». Ce fichier est l'endroit où cette règle est écrite.
 *
 * ⚠ Ces constantes sont des valeurs CSS littérales et non des `var(--token)`,
 * à dessein : elles servent aussi dans des styles en ligne et dans des popups
 * MapLibre, où `var()` n'est pas toujours résolu. Les couleurs, elles, passent
 * bien par les jetons — c'est une exception aux polices, pas une dispense.
 */

/** Police d'interface. Titres, libellés, corps de texte. */
export const fInter = "'Inter', system-ui, sans-serif";

/**
 * Police des DONNÉES : chiffres, codes, identifiants.
 *
 * `Fira Mono` est le repli voulu par le design system — l'omettre faisait
 * tomber directement sur le `monospace` du système, dont la chasse diffère.
 */
export const fMono = "'JetBrains Mono','Fira Mono',monospace";
