/**
 * Aides de spec de l'administration (factorisation F-4, lot 6, vague finale) : treize specs recopiaient
 * `doublerDialog`, vingt-sept `texte`, treize `espaces`, mot pour mot. Code de TEST seulement : aucun
 * écran ne l'importe.
 */

/**
 * jsdom n'implémente ni `showModal` ni `close` sur `<dialog>` : doublure minimale (l'attribut `open`),
 * posée une fois sur le prototype et jamais écrasée si le navigateur de test les fournit.
 */
export function doublerDialog(): void {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

/** Le texte d'un nœud, blancs fondus en une espace et rognés ; `''` sans nœud. */
export const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** `formaterNombre` sépare les milliers par une espace insécable : on compare sans elle. */
export const espaces = (s: string) => s.replace(/\s/g, ' ');
