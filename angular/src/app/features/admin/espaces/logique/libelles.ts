import { HttpErrorResponse } from '@angular/common/http';
import type { StatutJeu, TypeJeu } from './types';

/** Statut d'un jeu pour un espace (spec § 4.4), libellé affiché. */
export const LIBELLES_STATUT: Record<StatutJeu, string> = {
  proprietaire: 'Propriétaire',
  partage: 'Partagé',
  socle: 'Socle',
  non_visible: 'Non visible',
};

export const LIBELLES_TYPE: Record<TypeJeu, string> = { poi: 'POI', panneaux: 'Panneaux', carreaux: 'Carreaux' };

/**
 * Longueur maximale de la description d'un espace, à la création comme dans les Réglages. Le
 * serveur ne borne pas ce champ (`description: z.string().nullable().optional()` dans
 * `app/api/admin/organizations/[id]/route.ts`, colonne `text`) : la borne est celle de l'interface,
 * et une seule constante l'empêche de diverger d'un écran à l'autre.
 */
export const LONGUEUR_MAX_DESCRIPTION = 1000;

/** E2 : « Socle dentsu.explore », jamais l'ancien nom. */
export const NOM_SOCLE = 'Socle dentsu.explore';

/**
 * Message lisible d'une erreur d'appel.
 *
 * - Erreur HTTP : le `error` du corps (format `{ error }` des routes admin, 409 compris) ; sans lui
 *   (statut 0, page HTML d'un 500…), un message français. JAMAIS `HttpErrorResponse.message`, qui
 *   est en anglais et contient l'URL appelée.
 * - Autre erreur : son `message`, sinon « Erreur inattendue. ».
 */
export function messageErreur(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const corps = e.error as { error?: unknown } | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error) return corps.error;
    return e.status === 0 ? 'Le serveur n\'a pas répondu. Réessayez.' : `Erreur du serveur (code ${e.status}).`;
  }
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const m = (e as { message: string }).message;
    if (m) return m;
  }
  return 'Erreur inattendue.';
}
