import { Injectable, inject } from '@angular/core';
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

  get apiUrl(): string {
    return `${this.config.valeur.apiBaseUrl.replace(/\/+$/, '')}/api`;
  }

  url(chemin: string): string {
    return `${this.apiUrl}/${chemin.replace(/^\/+/, '')}`;
  }
}
