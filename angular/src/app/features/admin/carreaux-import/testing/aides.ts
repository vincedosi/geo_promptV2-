/** Aides des specs de l'import Shapefile (aucun import d'Angular : ce fichier n'est pas une spec, la garde des imports le lit). */

/** jsdom n'a ni DragEvent ni DataTransfer : un événement `drop` portant `dataTransfer.files`. */
export function deposer(el: HTMLElement, fichiers: File[]): void {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: fichiers, dropEffect: 'none' } });
  el.querySelector('[data-zone]')!.dispatchEvent(e);
}

/** Texte d'un élément, blancs (espaces insécables de `formaterNombre` compris) ramenés à une espace. */
export const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
