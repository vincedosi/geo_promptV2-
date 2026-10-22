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

/**
 * L'en-tête d'un accordéon du panneau (« Analyse spatiale », « Score composite », « Corrélation ») : bandeau
 * `--bg-level-2`, trait haut 1 px, liseré gauche teal à 25 %, trait bas 0,5 px — `PanneauAnalyse.tsx:320-334`,
 * `ScoreCompositeTool.tsx:247-262`, `CorrelationTool.tsx:141-156`, trois copies du même style.
 */
export const ENTETE_ACCORDEON = 'flex w-full cursor-pointer items-center gap-2 border-b-fin border-l-2 border-t border-b-subtle border-l-[color-mix(in_srgb,var(--brand-teal)_25%,transparent)] border-t-subtle bg-elevated px-[14px] py-[10px] transition-[background-color] duration-[180ms] ease-[var(--ease-out)]';
/** Le corps déplié d'un accordéon d'outil (`padding: 16`, colonnes espacées de 12, trait bas). */
export const CORPS_ACCORDEON = 'flex flex-col gap-3 border-b-fin border-subtle p-4';
/** `labelStyle` de `filter-panel/styles.ts`. */
export const LIBELLE_CHAMP = 'mb-1.5 text-[11px] font-medium text-secondary';
/** Les listes déroulantes des outils (`width 100 %`, fond `--bg-level-2`, 12 px). */
export const LISTE_CHAMP = 'w-full cursor-pointer rounded-[6px] border-fin border-subtle bg-elevated px-[10px] py-2 text-[12px] text-primary';
/** Le CTA teal des calculs (« Calculer le score », « Calculer la corrélation ») ; inactif : 40 %. */
export const BOUTON_CALCUL = 'rounded-[6px] border-fin border-teal bg-transparent px-4 py-2 text-[12px] font-medium text-teal disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-pointer';
/** L'encart d'erreur d'un outil (`C.redDim`, `C.redBorder`, `C.red`). */
export const ENCART_ERREUR = 'rounded-[4px] border-fin border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-[10px] py-2 text-[11px] leading-[1.5] text-danger';
/** L'encart d'avertissement (`C.amberDim`, bord ambre à 25 %, `C.amber`). */
export const ENCART_AVERTISSEMENT = 'rounded-[4px] border-fin border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-[10px] py-2 text-[11px] leading-[1.5] text-warning';

/** La classe de texte d'une teinte de ligne de journal. */
export const TEXTE_TEINTE: Readonly<Record<string, string>> = {
  success: 'text-success', danger: 'text-danger', warning: 'text-warning', secondary: 'text-secondary', tertiary: 'text-tertiary',
};

/**
 * La couleur de TEXTE d'un avertissement, lisible en thème clair (relecture T8, I3) — la recette de l'administration
 * (`cadre-admin.component.ts`, DESIGN_SYSTEM « Teal et statut en TEXTE sur fond clair ») : en clair, `--warning` mêlé
 * à 50 % de `--text-primary` ; en sombre, `--warning` inchangé. `light-dark()` se résout d'après le `color-scheme` de
 * l'hôte. Mesuré : 6,3:1 sur le fond de l'encart en clair (2,7:1 avec `--warning` seul), 9,6:1 en sombre.
 */
export const TEXTE_AVERTISSEMENT = 'text-[color:light-dark(color-mix(in_srgb,var(--warning)_50%,var(--text-primary)),var(--warning))]';
/**
 * L'encart d'avertissement de la couverture d'une zone (messages Q-J : territoire non carroyé, zone sans carreau) :
 * le fond et le bord d'`ENCART_AVERTISSEMENT`, le texte `TEXTE_AVERTISSEMENT`. `ENCART_AVERTISSEMENT` reste tel quel
 * pour la corrélation (hors du périmètre de T8).
 */
export const ENCART_AVERTISSEMENT_LISIBLE = `rounded-[4px] border-fin border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-[10px] py-2 text-[11px] leading-[1.5] ${TEXTE_AVERTISSEMENT}`;
