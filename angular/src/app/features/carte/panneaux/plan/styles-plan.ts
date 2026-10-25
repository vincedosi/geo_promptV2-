/**
 * Les classes partagées des sections de ⑥ Plan (lot 6, T4-T6), écrites en littéral : Tailwind lit le source.
 */

/**
 * Le champ texte du wizard (`TextInput` de `StepCible.tsx`) : fond de niveau 2, bord subtil, focus teal à 50 %.
 */
export const SAISIE = 'w-full rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2.5 text-[13px] text-primary outline-none transition-[border-color] duration-150 placeholder:text-tertiary focus:border-[var(--brand-teal-50)] disabled:opacity-50';

/** Le champ de montant dans une ligne (`RowBudgetInput` de `StepCanaux.tsx`) : 110 px, chiffres à droite, mono 13 px. */
export const SAISIE_MONTANT = 'w-[110px] rounded-[6px] border-fin border-subtle bg-elevated px-2 py-1.5 text-right font-mono text-[13px] text-primary outline-none transition-[border-color] duration-150 placeholder:text-tertiary focus:border-[var(--brand-teal-50)] disabled:opacity-50';

/** Les listes et champs des liaisons (`LinkSelect`, `LevelInput`) : comme `SAISIE`, en plus serré. */
export const SAISIE_LIAISON = 'w-full rounded-[6px] border-fin border-subtle bg-elevated px-2.5 py-2 text-[13px] text-primary outline-none transition-[border-color] duration-150 placeholder:text-tertiary focus:border-[var(--brand-teal-50)] disabled:cursor-not-allowed disabled:opacity-50';

/** L'intitulé d'un niveau de liaison (10 px tertiaire ; React l'écrivait en capitales, ici en sentence case). */
export const LIBELLE_NIVEAU = 'mb-1.5 block text-[10px] text-tertiary';

/**
 * Le TEXTE d'un état « lié » (`var(--success)` chez React) lisible en thème clair : la recette de l'avertissement de
 * ④ (`styles-analyse.ts`, `TEXTE_AVERTISSEMENT`) — en clair, `--success` mêlé à 50 % de `--text-primary` ; en sombre,
 * `--success` inchangé. `light-dark()` se résout d'après le `color-scheme` de l'hôte.
 */
export const TEXTE_SUCCES = 'text-[color:light-dark(color-mix(in_srgb,var(--success)_50%,var(--text-primary)),var(--success))]';

/**
 * Le CTA principal (DESIGN_SYSTEM § 5) : `--text-primary` sur `--bg-primary`, inversé en clair par les jetons ; survol
 * par l'opacité. Sans marges intérieures : le pied (« Créer la campagne → ») et le hall (« Nouvelle campagne ») gardent
 * chacun celles de leur écran React (revue finale, F-6).
 */
export const CTA = 'rounded-[6px] border-0 bg-[var(--text-primary)] text-[13px] font-medium text-[var(--bg-primary)] transition-opacity duration-150 enabled:cursor-pointer enabled:hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50';

/** Le cadre d'un panneau de liaison (`border 0.5px`, rayon 8, `12px 14px`, colonnes espacées de 12). */
export const CADRE_LIAISON = 'flex flex-col gap-3 rounded-[8px] border-fin border-subtle px-3.5 py-3';
