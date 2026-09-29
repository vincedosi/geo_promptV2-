import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Ce que l'application lit à l'exécution, jamais à la compilation. */
export interface ConfigApplication {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Origine de l'API ; vide = même origine (proxy de dev). AIDA la résoudra depuis le slug. */
  apiBaseUrl: string;
  /** Identifiant de l'application dans AIDA ; vide tant que le groupe ne l'a pas fourni. */
  slug: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  // HttpBackend et non HttpClient : cette requête précède le chargement de la
  // configuration elle-même, et jetonInterceptor lit HttpBaseService.apiUrl,
  // qui lit ConfigService.valeur — appeler http.get() ici via le pipeline
  // d'intercepteurs lèverait donc AVANT même de partir (config pas chargée).
  private readonly http = new HttpClient(inject(HttpBackend));
  private config: ConfigApplication | null = null;

  /** Lit /config.local.json. Rejette avec un message qui dit quoi faire. */
  async charger(): Promise<void> {
    let brut: Partial<ConfigApplication>;
    try {
      brut = await firstValueFrom(this.http.get<Partial<ConfigApplication>>('/config.local.json'));
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
      slug: brut.slug ?? '',
    };
  }

  get valeur(): ConfigApplication {
    if (!this.config) throw new Error('Configuration pas encore chargée.');
    return this.config;
  }
}
