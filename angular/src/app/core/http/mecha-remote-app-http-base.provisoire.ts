import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { ConfigService } from '../config/config.service';

/**
 * DOUBLURE PROVISOIRE de `MechaRemoteAppHttpBaseService`
 * (`@gdo-rd-france/mecha-lib-ui` 0.0.81), inaccessible tant que le siège n'a pas
 * fourni le jeton `NPM_GITHUB_TOKEN`. Elle reproduit la SEULE surface que la doc
 * AIDA montre : un constructeur qui reçoit le slug, `httpClient`, `baseUrl`.
 *
 * Le jour où le paquet est installé, `http-base.service.ts` change UNE ligne
 * (son import) et ce fichier est supprimé. Ce que le vrai service fait de plus
 * (en-têtes ? session ?) est une question posée au siège le 2026-09-30.
 *
 * `baseUrl` rend l'ORIGINE de l'API, sans `/api` : c'est `HttpBaseService` qui
 * l'ajoute, exactement comme dans la doc (`super.baseUrl + '/api'`).
 */
export abstract class MechaRemoteAppHttpBaseServiceProvisoire {
  protected readonly httpClient = inject(HttpClient);
  private readonly configuration = inject(ConfigService);

  protected constructor(protected readonly slug: string) {}

  get baseUrl(): string {
    return this.configuration.valeur.apiBaseUrl.replace(/\/+$/, '');
  }
}
