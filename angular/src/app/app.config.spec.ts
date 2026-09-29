import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { appConfig } from './app.config';
import { SUPABASE } from './core/auth/supabase';
import { ConfigService } from './core/config/config.service';

/**
 * Couvre le VRAI graphe de providers d'appConfig — les specs unitaires de
 * ConfigService et jetonInterceptor mockent chacune l'autre bout de la
 * dépendance circulaire (config -> intercepteur -> HttpBaseService ->
 * ConfigService.valeur) et ne l'auraient donc jamais attrapée, pas plus que
 * le inject() après await de provideAppInitializer (NG0203). Ce test
 * démarre l'application EXACTEMENT comme main.ts, sans rien mocker du côté
 * config/HTTP — seul le client Supabase est remplacé.
 */
function fauxSupabase() {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}

describe('appConfig — démarrage réel', () => {
  it('charge /config.local.json sans Bearer puis résout l\'initialisation (pas de NG0203)', async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: fauxSupabase() }],
    });

    // Premier TestBed.inject(...) : déclenche TestBed.finalize(), qui appelle
    // ApplicationInitStatus.runInitializers() — donc le provideAppInitializer
    // d'appConfig, qui lance ConfigService.charger() synchronement jusqu'à
    // son premier await (le GET part donc déjà vers HttpTestingController).
    const http = TestBed.inject(HttpTestingController);
    const statut = TestBed.inject(ApplicationInitStatus);

    const requete = http.expectOne('/config.local.json');
    expect(requete.request.headers.has('Authorization')).toBe(false);
    requete.flush({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseAnonKey: 'cle-de-test',
      apiBaseUrl: '',
      slug: '',
    });

    await statut.donePromise;

    expect(TestBed.inject(ConfigService).valeur.supabaseUrl).toBe('http://127.0.0.1:54321');
  });
});
