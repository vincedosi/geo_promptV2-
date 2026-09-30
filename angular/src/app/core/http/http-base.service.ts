import { DOCUMENT, Injectable, inject } from '@angular/core';
import { ConfigService } from '../config/config.service';

/**
 * Construit TOUTES les adresses de l'API. Aucun service ne compose une URL
 * lui-même : le jour de l'intégration AIDA, cette classe héritera de
 * `MechaRemoteAppHttpBaseService` (qui résout l'origine depuis le slug) et
 * aucun service métier ne changera.
 */
@Injectable({ providedIn: 'root' })
export class HttpBaseService {
  private readonly config = inject(ConfigService);
  private readonly document = inject(DOCUMENT);

  get apiUrl(): string {
    return `${this.config.valeur.apiBaseUrl.replace(/\/+$/, '')}/api`;
  }

  url(chemin: string): string {
    return `${this.apiUrl}/${chemin.replace(/^\/+/, '')}`;
  }

  /**
   * Comme `url()`, mais toujours ABSOLUE : MapLibre lit ses tuiles dans un
   * worker, où une adresse relative ne se résout contre rien. Résolue contre
   * `document.baseURI` (et non `location`), pour suivre un éventuel `<base>`
   * de l'intégration. Les jetons `{z}/{x}/{y}` sont rétablis : `URL` encode
   * les accolades du chemin en `%7B…%7D`, et MapLibre ne les reconnaîtrait plus.
   */
  urlAbsolue(chemin: string): string {
    return new URL(this.url(chemin), this.document.baseURI).href
      .replace(/%7B(z|x|y)%7D/gi, (_, c: string) => `{${c.toLowerCase()}}`);
  }
}
