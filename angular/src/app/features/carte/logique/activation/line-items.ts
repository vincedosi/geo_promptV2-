/**
 * ⑦ Activation — la saisie des line items DV360 (lot 7, T3, A-8), PURE. Même découpe que React
 * (`ActivationPanel.tsx:166-170`) : espaces, virgules, points-virgules et retours séparent ; seuls les jetons faits de
 * chiffres sont gardés, dans l'ordre, sans dédoublonnage. Copie DÉCLARÉE (ruling 2 du lot 7), retirée à la bascule
 * React ; `line-items.spec.ts` rejoue les cas de React.
 */

/** Le plafond de la route (`MAX_CIBLES` de `lib/campaigns/activation.ts`) : au-delà, `pousser` refuse en 400.
 * Copie verrouillée par `tests/unit/angular/activation-paritaire.test.ts`. */
export const MAX_LINE_ITEMS = 50;

/** React, mot pour mot : aucun jeton n'est fait de chiffres. */
export const MESSAGE_AUCUN_LINE_ITEM = 'Aucun identifiant de line item valide (chiffres uniquement).';
export const MESSAGE_TROP_DE_LINE_ITEMS = `${MAX_LINE_ITEMS} line items au plus.`;

/** Les identifiants gardés, et le nombre de jetons écartés (pas uniquement des chiffres). */
export function lireLineItems(brut: string): { ids: string[]; invalides: number } {
  const jetons = brut.split(/[\s,;]+/).map((v) => v.trim()).filter((v) => v !== '');
  const ids = jetons.filter((v) => /^\d+$/.test(v));
  return { ids, invalides: jetons.length - ids.length };
}

/** Pourquoi la saisie ne peut pas partir, `null` si elle le peut : aucun identifiant, ou plus que la route n'accepte. */
export function refusLineItems(l: { ids: readonly string[] }): string | null {
  if (!l.ids.length) return MESSAGE_AUCUN_LINE_ITEM;
  return l.ids.length > MAX_LINE_ITEMS ? MESSAGE_TROP_DE_LINE_ITEMS : null;
}
