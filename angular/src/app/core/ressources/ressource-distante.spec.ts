import { TestBed } from '@angular/core/testing';
import { BASE_DISTANTE, BASE_RESSOURCES, urlRessourceDistante } from './ressource-distante';

describe('urlRessourceDistante', () => {
  it('résout contre la base de l\'application distante, pas contre le document', () => {
    expect(urlRessourceDistante('config.local.json', 'https://distante.exemple/magelian/chunk-ABC.js'))
      .toBe('https://distante.exemple/magelian/config.local.json');
  });

  it('ignore le chemin du document hôte : le shell peut être servi ailleurs, sous un autre préfixe', () => {
    expect(urlRessourceDistante('magelian.css', 'https://cdn.exemple/remotes/magelian/Routes-XYZ.js'))
      .toBe('https://cdn.exemple/remotes/magelian/magelian.css');
  });

  it('sans base fournie, résout contre l\'URL du module (import.meta.url)', () => {
    expect(urlRessourceDistante('maplibre.css')).toBe(new URL('maplibre.css', BASE_DISTANTE).href);
  });
});

describe('BASE_RESSOURCES', () => {
  it('vaut par défaut l\'URL du module empaqueté', () => {
    expect(TestBed.inject(BASE_RESSOURCES)).toBe(BASE_DISTANTE);
  });
});
