import { HttpErrorResponse } from '@angular/common/http';
import { type Observable, map } from 'rxjs';
import type { DetailJeuZone, JeuxApi } from '../data/jeux.api';
import { MESSAGE_JEU_RISQUE } from '../logique/jeu/ecran';

/**
 * La lecture d'un jeu de ZONE par `JeuZonesService` (B10) : extraite du service, arrivé au plafond de 400 lignes
 * (`taille-fichiers.test.ts`), à comportement constant — un jeu risque est refusé par sa phrase, un jeu perdu (404 ou
 * risque) retire `?jeu=`.
 */

/** Un jeu RISQUE reçu par ⑤ : la phrase que le serveur rend dans l'autre sens (`MESSAGE_JEU_RISQUE`). */
export class JeuRisque extends Error {
  constructor() { super(MESSAGE_JEU_RISQUE); }
}

/** `GET /api/zones/jeux/[id]`, refusé (`JeuRisque`) si c'est un jeu risque. */
export function lireJeuDeZone(api: JeuxApi, id: string): Observable<DetailJeuZone> {
  return api.lire(id).pipe(map((r) => {
    if (r.jeu.type !== 'zone') throw new JeuRisque();
    return r as DetailJeuZone;
  }));
}

/** Le jeu n'est plus à ouvrir : un jeu risque, ou un 404 (supprimé, d'un autre espace). */
export function jeuPerdu(e: unknown): boolean {
  return e instanceof JeuRisque || (e instanceof HttpErrorResponse && e.status === 404);
}
