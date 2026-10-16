import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { type Observable, catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ZonesApi } from '../data/zones.api';
import { messageErreurSource } from '../logique/zones/creation-zone';
import { MESSAGE_SAUVEGARDE_ECHOUEE } from '../logique/zones/operations-zones';
import { type Recette, exigeGeometrie } from '../logique/zones/recette';

/**
 * L'issue d'une création : la réponse de la route source et le nombre de codes postaux résolus — plus, après un 207,
 * l'avertissement de la route (le compte de codes postaux n'est alors pas à dire) —, ou le message d'échec.
 */
export type IssueCreation<G> = { geo: G; countCp: number | undefined; avertissement?: string } | { erreur: string };

/** Le repli d'un 207 de `POST /api/zones` sans `message`. */
const AVERTISSEMENT_207 = 'Zone créée ; ses codes postaux n’ont pas pu être résolus.';

/**
 * Le geste commun des créateurs « historiques » de ③ (codes postaux, rayon, dessin — lot 4, T16) et du « Créer la
 * zone » du score composite : la route source calcule la géométrie (l'aperçu), puis `POST /api/zones` ÉCRIT la zone
 * AVEC SA RECETTE (lot 3, L3-6) et résout ses codes postaux. Le serveur rejoue une recette qu'il sait calculer ; la
 * géométrie n'est envoyée que pour une forme figée (`exigeGeometrie` : dessin, import, isochrone, capture — arbitrage P5).
 *
 * Messages de React : un refus de la route source dit sa raison (`message`, puis `error`, puis « Erreur <statut> ») ;
 * un échec de l'écriture dit « Sauvegarde de la zone échouée. ». Un 207 (codes non résolus) reste une réussite : la
 * zone existe, elle n'est jamais renvoyée ; son `message` arrive comme `avertissement`.
 *
 * L'écriture n'a plus besoin de l'organisation (l'espace est celui de la session, côté serveur). `org` reste lue : la
 * capture (`mg-capture`, route `/api/custom-geo/capture`) et les boutons des créateurs s'en servent encore — sans
 * organisation, ils restent inactifs.
 */
@Injectable()
export class CreationZoneService {
  private readonly zonesApi = inject(ZonesApi);

  /** `undefined` pendant la lecture du profil, `null` sans organisation : les boutons restent inactifs. */
  readonly org = signal<string | null | undefined>(undefined);

  constructor() {
    let detruit = false;
    inject(DestroyRef).onDestroy(() => (detruit = true));
    void inject(AuthService).lireProfil().then((p) => {
      if (!detruit) this.org.set(p?.organisation ?? null);
    });
  }

  /**
   * Enchaîne la route source et l'écriture. `nom` et `recette` sont composés à partir de la réponse source. Ne lève
   * jamais : l'échec arrive comme `{ erreur }`.
   */
  creer<G extends { geometry: GeoJSON.Geometry }>(
    source: Observable<G>,
    nom: (geo: G) => string,
    recette: (geo: G) => Recette,
  ): Observable<IssueCreation<G>> {
    if (!this.org()) return of({ erreur: MESSAGE_SAUVEGARDE_ECHOUEE });
    return source.pipe(
      map((geo) => ({ geo })),
      catchError((e: { status?: number; error?: unknown }) => of({ erreur: messageErreurSource(e) })),
      switchMap((r): Observable<IssueCreation<G>> => {
        if ('erreur' in r) return of(r);
        const { geo } = r;
        const rec = recette(geo);
        const corps = { nom: nom(geo).slice(0, 200), recette: rec, ...(exigeGeometrie(rec) ? { geometrie: geo.geometry } : {}) };
        return this.zonesApi.enregistrer(corps).pipe(
          map((reponse): IssueCreation<G> => (reponse.status === 207
            ? { geo, countCp: reponse.body?.count_cp, avertissement: reponse.body?.message ?? AVERTISSEMENT_207 }
            : { geo, countCp: reponse.body?.count_cp })),
          catchError(() => of({ erreur: MESSAGE_SAUVEGARDE_ECHOUEE })),
        );
      }),
    );
  }
}
