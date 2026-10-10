import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { type Observable, catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { type ZoneAEnregistrer, ZonesCustomApi } from '../data/zones-custom.api';
import { messageErreurSource } from '../logique/zones/creation-zone';
import { MESSAGE_SAUVEGARDE_ECHOUEE } from '../logique/zones/operations-zones';

/** L'issue d'une création : la réponse de la route source et le nombre de codes postaux résolus, ou le message d'échec. */
export type IssueCreation<G> = { geo: G; countCp: number | undefined } | { erreur: string };

/**
 * Le geste commun aux trois outils de « Créer une zone » (codes postaux, rayon, dessin — lot 4, T16) : la route
 * source calcule la géométrie, puis `/api/custom-geo/save` ÉCRIT la zone et résout ses codes postaux. Les trois
 * composants React le recopiaient chacun (`CreerZone*.tsx`) ; il est écrit une fois ici.
 *
 * Messages de React : un refus de la route source dit sa raison (`message`, puis `error`, puis « Erreur <statut> ») ;
 * un échec de la sauvegarde dit « Sauvegarde de la zone échouée. ». Un 207 (codes non résolus) reste une réussite,
 * comme React (`saveRes.ok`).
 *
 * L'organisation est celle du profil ACTIF, lue à la construction : le service est fourni par le panneau Zones, donc
 * relu à chaque ouverture — un changement d'organisation ferme le panneau (T14).
 */
@Injectable()
export class CreationZoneService {
  private readonly api = inject(ZonesCustomApi);

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
   * Enchaîne la route source et la sauvegarde. `zone` compose le corps de `/save` (sans l'organisation, ajoutée ici)
   * à partir de la réponse source. Ne lève jamais : l'échec arrive comme `{ erreur }`.
   */
  creer<G extends { geometry: GeoJSON.Geometry }>(
    source: Observable<G>,
    zone: (geo: G) => Omit<ZoneAEnregistrer, 'org_id' | 'geometry'>,
  ): Observable<IssueCreation<G>> {
    const org = this.org();
    if (!org) return of({ erreur: MESSAGE_SAUVEGARDE_ECHOUEE });
    return source.pipe(
      map((geo) => ({ geo })),
      catchError((e: { status?: number; error?: unknown }) => of({ erreur: messageErreurSource(e) })),
      switchMap((r): Observable<IssueCreation<G>> => {
        if ('erreur' in r) return of(r);
        const { geo } = r;
        return this.api.enregistrer({ ...zone(geo), geometry: geo.geometry, org_id: org }).pipe(
          map((reponse) => ({ geo, countCp: reponse.body?.count_cp })),
          catchError(() => of({ erreur: MESSAGE_SAUVEGARDE_ECHOUEE })),
        );
      }),
    );
  }
}
