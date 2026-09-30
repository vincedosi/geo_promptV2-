import { DOCUMENT, Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { MechaRemoteAppHttpBaseServiceProvisoire } from './mecha-remote-app-http-base.provisoire';

/**
 * Base de TOUS les services d'API (doc AIDA §4.2-4.3) : un service métier
 * HÉRITE de cette classe et appelle `this.httpClient` avec `${this.baseUrl}/…`,
 * jamais un `HttpClient` injecté à part ni une URL recomposée.
 */
@Injectable({ providedIn: 'root' })
export class HttpBaseService extends MechaRemoteAppHttpBaseServiceProvisoire {
  private readonly document = inject(DOCUMENT);

  constructor() {
    super(environment.slug);
  }

  public override get baseUrl(): string {
    return super.baseUrl + '/api';
  }

  /**
   * Adresse ABSOLUE d'une ressource de l'API : MapLibre lit ses tuiles dans un
   * worker, où une adresse relative ne se résout contre rien. Résolue contre
   * `document.baseURI` ; les jetons `{z}/{x}/{y}` sont rétablis (`URL` les
   * encode en `%7B…%7D`, et MapLibre ne les reconnaîtrait plus).
   */
  protected urlAbsolue(chemin: string): string {
    return new URL(`${this.baseUrl}/${chemin.replace(/^\/+/, '')}`, this.document.baseURI).href
      .replace(/%7B(z|x|y)%7D/gi, (_, c: string) => `{${c.toLowerCase()}}`);
  }
}
