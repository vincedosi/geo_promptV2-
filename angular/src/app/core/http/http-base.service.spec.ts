import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { ConfigService } from '../config/config.service';
import { HttpBaseService } from './http-base.service';

function configurer(config: { apiBaseUrl: string }) {
  TestBed.configureTestingModule({
    providers: [{ provide: ConfigService, useValue: { valeur: config } }],
  });
}

/** Sous-classe de sonde : `urlAbsolue` est protégée, comme dans un vrai service métier. */
@Injectable({ providedIn: 'root' })
class Sonde extends HttpBaseService {
  absolue(chemin: string): string {
    return this.urlAbsolue(chemin);
  }
  get client(): HttpClient {
    return this.httpClient;
  }
}

describe('HttpBaseService', () => {
  it('baseUrl = origine configurée + /api, sans barre en double', () => {
    configurer({ apiBaseUrl: 'https://api.exemple.fr/' });
    expect(TestBed.inject(HttpBaseService).baseUrl).toBe('https://api.exemple.fr/api');
  });

  it("baseUrl relatif quand l'origine est vide (même origine, proxy de dev)", () => {
    configurer({ apiBaseUrl: '' });
    expect(TestBed.inject(HttpBaseService).baseUrl).toBe('/api');
  });

  it("transmet le slug d'environment au service parent", () => {
    configurer({ apiBaseUrl: '' });
    expect((TestBed.inject(HttpBaseService) as unknown as { slug: string }).slug).toBe(environment.slug);
  });

  it("une sous-classe reçoit un httpClient réel (champ de la classe mère, résolu dans l'injecteur de la sous-classe)", () => {
    configurer({ apiBaseUrl: '' });
    TestBed.configureTestingModule({ providers: [] });
    expect(TestBed.inject(Sonde).client).toBeInstanceOf(HttpClient);
  });

  it('urlAbsolue : résout une adresse relative contre la base du document', () => {
    configurer({ apiBaseUrl: '' });
    expect(TestBed.inject(Sonde).absolue('tiles/zones-risque/{z}/{x}/{y}?profil=a%20b'))
      .toBe(`${new URL(document.baseURI).origin}/api/tiles/zones-risque/{z}/{x}/{y}?profil=a%20b`);
  });

  it('urlAbsolue : garde les accolades {z}/{x}/{y} littérales', () => {
    configurer({ apiBaseUrl: '' });
    const u = TestBed.inject(Sonde).absolue('tiles/zones-risque/{z}/{x}/{y}');
    expect(u).toContain('/api/tiles/zones-risque/{z}/{x}/{y}');
    expect(u).not.toContain('%7B');
  });

  it('urlAbsolue : laisse une origine explicite intacte', () => {
    configurer({ apiBaseUrl: 'https://magelian.exemple.test' });
    expect(TestBed.inject(Sonde).absolue('tiles/x/{z}')).toBe('https://magelian.exemple.test/api/tiles/x/{z}');
  });
});
