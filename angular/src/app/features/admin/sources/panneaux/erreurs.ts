import { HttpErrorResponse } from '@angular/common/http';

/**
 * Le texte que React affiche quand `fetch` lui-même échoue (`String(err)` d'un `TypeError`), repris
 * pour une coupure réseau (`HttpErrorResponse` de statut 0) — les trois écritures de l'onglet DSP et des
 * Zones perso le montrent dans une notification ou dans le dialogue.
 */
export const ECHEC_RESEAU = 'TypeError: Failed to fetch';

/** Une coupure réseau (aucune réponse du serveur) et non un refus HTTP. */
export function estCoupure(e: unknown): boolean {
  return e instanceof HttpErrorResponse && e.status === 0;
}

/**
 * Le champ `error` du corps d'un refus HTTP. Trois réponses (vague finale D12 : ce commentaire disait `null`
 * pour les trois cas d'absence) :
 * - le message, quand le corps JSON porte un `error` non vide ;
 * - `undefined`, quand le corps est un objet JSON SANS `error` (ou un `error` vide ou non textuel) ;
 * - `null`, quand le corps est vide ou illisible (un HTML de passerelle, par exemple).
 * Le corps arrive en objet pour une réponse JSON, en TEXTE pour une requête demandée en texte (le flux SSE
 * de l'import, C4) : il est alors relu par `JSON.parse`.
 *
 * `undefined` distingue « corps JSON sans `error` » de « corps illisible » : React les traite
 * différemment pour la suppression d'une campagne (`body.error || 'Suppression échouée'` contre
 * `HTTP <statut>`, `useDspImport.ts:131-132`).
 */
export function erreurDuCorps(e: HttpErrorResponse): string | null | undefined {
  let corps: unknown = e.error;
  if (typeof corps === 'string') {
    try {
      corps = JSON.parse(corps);
    } catch {
      return null;
    }
  }
  if (!corps || typeof corps !== 'object') return null;
  const erreur = (corps as { error?: unknown }).error;
  return typeof erreur === 'string' && erreur ? erreur : undefined;
}
