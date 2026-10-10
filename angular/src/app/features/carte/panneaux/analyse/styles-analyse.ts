/**
 * Les classes des pastilles et boutons des outils d'analyse — `pill(actif, couleur)` et `primaryBtn(couleur, désactivé)`
 * de `filter-panel/styles.ts`, déclinés pour les couleurs que les outils emploient (lot 4, T17). Les déclinaisons
 * neutres (`PASTILLE_ACTIVE` / `PASTILLE_INACTIVE` / `BOUTON_DESACTIVE`) sont celles du panneau Calques, reprises.
 *
 * Écarts de couleur, justifiés : `pill`/`primaryBtn` ne savent pas lire `var()` — un jeton passé en couleur donnait un
 * fond BLANC translucide (`hexToRgb` replié sur 240,240,240) ; c'est ici `--text-primary` au même pourcentage, comme
 * au panneau Calques. Les deux teintes que React écrivait en hexadécimal deviennent des jetons : le gris `#6b7280` des
 * boutons « VÉRIFIER CACHE » → `--text-tertiary` ; le cyan `#22d3ee` du « LANCER » de la V2 → `--brand-teal`.
 */
export { BOUTON_DESACTIVE, PASTILLE_ACTIVE, PASTILLE_INACTIVE } from '../calques/section-transport.component';

/** `pill(true, 'var(--text-primary)')` : mode de transport, durée ou palier choisi. */
export const PASTILLE_PRIMAIRE_ACTIVE = 'border-primary text-primary bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]';

const FOND_ACTIF = 'bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]';
/** `primaryBtn(couleur)` actifs, par couleur. */
export const BOUTON_GRIS = `cursor-pointer border-tertiary text-tertiary ${FOND_ACTIF}`;
export const BOUTON_DANGER = `cursor-pointer border-danger text-danger ${FOND_ACTIF}`;
export const BOUTON_AVERTISSEMENT = `cursor-pointer border-warning text-warning ${FOND_ACTIF}`;
export const BOUTON_TEAL = 'cursor-pointer border-teal text-teal bg-[color-mix(in_srgb,var(--brand-teal)_10%,transparent)]';

/** Le gabarit commun de `primaryBtn` (taille, bord, transition). */
export const BOUTON_PRIMAIRE = 'w-full rounded-[4px] border-fin px-[14px] py-[9px] text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]';
/** Le gabarit commun de `pill`. */
export const PASTILLE = 'shrink-0 cursor-pointer rounded-[4px] border-fin px-[9px] py-[5px] text-[11px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]';

/** La classe de texte d'une teinte de ligne de journal. */
export const TEXTE_TEINTE: Readonly<Record<string, string>> = {
  success: 'text-success', danger: 'text-danger', warning: 'text-warning', secondary: 'text-secondary', tertiary: 'text-tertiary',
};
