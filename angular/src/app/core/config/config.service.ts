import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BASE_RESSOURCES, urlRessourceDistante } from '../ressources/ressource-distante';

/** Ce que l'application lit à l'exécution, jamais à la compilation. */
export interface ConfigApplication {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Origine de l'API ; vide = même origine (proxy de dev). AIDA la résoudra depuis le slug (environment.ts). */
  apiBaseUrl: string;
  /**
   * Clé Google Maps de la vue Street View (lot 4, T8, B17) — FACULTATIVE : absente, le tiroir d'un panneau affiche un
   * bandeau qui nomme la variable manquante. Écrite par `npm run config` depuis `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
   */
  googleMapsKey?: string;
  /**
   * Origine de l'application React (Next.js), FACULTATIVE : les étapes ⑤-⑦ du parcours de la carte y renvoient tant
   * qu'elles ne sont pas portées (arbitrage A7). Écrite par `npm run config` depuis `NEXT_PUBLIC_APP_URL` ; absente
   * dans un hôte AIDA, où aucun lien n'est affiché.
   */
  urlApplicationReact?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  // HttpBackend et non HttpClient : cette requête précède le chargement de la
  // configuration elle-même, et jetonInterceptor lit HttpBaseService.baseUrl,
  // qui lit ConfigService.valeur — appeler http.get() ici via le pipeline
  // d'intercepteurs lèverait donc AVANT même de partir (config pas chargée).
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly base = inject(BASE_RESSOURCES);
  private config: ConfigApplication | null = null;

  /**
   * Lit `config.local.json` À CÔTÉ de l'application distante — jamais
   * `/config.local.json`, qui dans le shell AIDA viserait l'origine du SHELL
   * (voir `ressource-distante.ts`). Rejette avec un message qui dit quoi faire.
   */
  async charger(): Promise<void> {
    let brut: Partial<ConfigApplication>;
    try {
      brut = await firstValueFrom(this.http.get<Partial<ConfigApplication>>(urlRessourceDistante('config.local.json', this.base)));
    } catch {
      throw new Error(
        'Configuration locale introuvable. Dans le dossier angular/, lancer : npm run config',
      );
    }
    if (!brut?.supabaseUrl || !brut?.supabaseAnonKey) {
      throw new Error('Configuration locale incomplète : relancer npm run config dans angular/.');
    }
    this.config = {
      supabaseUrl: brut.supabaseUrl,
      supabaseAnonKey: brut.supabaseAnonKey,
      apiBaseUrl: brut.apiBaseUrl ?? '',
      ...(brut.googleMapsKey ? { googleMapsKey: brut.googleMapsKey } : {}),
      ...(brut.urlApplicationReact ? { urlApplicationReact: brut.urlApplicationReact } : {}),
    };
  }

  get valeur(): ConfigApplication {
    if (!this.config) throw new Error('Configuration pas encore chargée.');
    return this.config;
  }
}
