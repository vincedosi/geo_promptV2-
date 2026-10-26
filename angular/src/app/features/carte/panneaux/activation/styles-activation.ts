/**
 * Les classes partagées de ⑦ Activation (lot 7, T4), écrites en littéral : Tailwind lit le source.
 *
 * React écrit ses encarts en `rgba(…)` en dur (`ActivationPanel.tsx`) et leur TEXTE dans la couleur de statut : ici
 * fond et bord passent par `color-mix` sur les jetons, et le texte reste `--text-primary` — le statut se lit par le bord
 * et le point (contraste tenu dans les deux thèmes ; la carte n'a pas les `--*-texte` du cadre admin).
 */

/** Une carte de ⑦ (`section` de React : surface, bord subtil, rayon 8, 14 px). */
export const CADRE = 'flex flex-col gap-2.5 rounded-[8px] border-fin border-subtle bg-surface p-3.5';

/**
 * Les blocages d'une carte (`rgba(247,183,49,0.08)` / `0.25` de React). Voisin de `FOND_AVERTISSEMENT`
 * (`styles-analyse.ts`) mais pas égal — 8 % et non 10 %, rayon 6 et non 4, 11 × 9 px : les mesures d'`ActivationPanel.tsx`.
 */
export const ENCART_MOTIF = 'rounded-[6px] border-fin border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-[11px] py-[9px] text-[11px] leading-[1.6] text-primary';

/** « Prêt à activer » (`rgba(61,255,160,0.08)` / `0.2` de React). */
export const ENCART_PRET = 'rounded-[6px] border-fin border-[color-mix(in_srgb,var(--success)_20%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] px-[11px] py-[9px] text-[11px] text-primary';

/** Le champ de saisie de React (fond de niveau 2, bord subtil, mono 11 px), focus teal — `SAISIE_LIAISON` de ⑥ est en
 * Inter 13 px : deux champs différents dans React, gardés distincts. */
export const SAISIE_MONO = 'w-full rounded-[6px] border-fin border-subtle bg-elevated px-2.5 py-[7px] font-mono text-[11px] text-primary outline-none placeholder:text-tertiary focus:border-[var(--brand-teal-50)]';

/**
 * Le bouton teal de React (`0.5px solid --brand-teal`, inactif à 40 %), avec son survol. Nommé `BOUTON_TEAL` jusqu'à la
 * revue finale du lot 7 (F-4) : homonyme du `BOUTON_TEAL` de `styles-analyse.ts`, qui est une pastille ACTIVE et non un
 * bouton. `BOUTON_CALCUL` (même dessin) n'est pas repris : 2 px de marge de plus et pas de survol, contre React.
 */
export const BOUTON_POUSSEE = 'rounded-[6px] border-fin border-teal bg-transparent px-3.5 py-[7px] text-[12px] font-medium text-teal enabled:cursor-pointer enabled:hover:bg-teal-10 disabled:cursor-not-allowed disabled:opacity-40';

/** Le petit bouton neutre de l'historique (« Annuler ce lot »). */
export const BOUTON_NEUTRE = 'cursor-pointer rounded-[4px] border-fin border-default bg-transparent px-2.5 py-1 text-[11px] text-secondary hover:border-hover hover:text-primary';

/** La couleur du POINT d'un statut de lot (`COULEUR_STATUT` de React) ; le libellé, lui, reste en texte primaire. */
export const POINT_STATUT: Readonly<Record<string, string>> = {
  termine: 'bg-success', partiel: 'bg-warning', echec: 'bg-danger', annule: 'bg-tertiary', en_cours: 'bg-teal',
};
