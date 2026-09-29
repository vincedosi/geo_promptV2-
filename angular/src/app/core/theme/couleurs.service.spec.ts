import { TestBed } from '@angular/core/testing';
import { CouleursService } from './couleurs.service';
import { ThemeService } from './theme.service';

describe('CouleursService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.setProperty('--essai-a', '#112233');
    document.documentElement.style.setProperty('--essai-b', ' rgba(1, 2, 3, 0.5) ');
  });
  afterEach(() => {
    document.documentElement.style.removeProperty('--essai-a');
    document.documentElement.style.removeProperty('--essai-b');
  });

  it('rend la valeur calculée de chaque jeton, sous les clés de l\'appelant', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a', trait: 'essai-b' });
    TestBed.tick();
    expect(p()).toEqual({ fond: '#112233', trait: 'rgba(1, 2, 3, 0.5)' });
  });

  it('relit après une bascule de thème', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a' });
    TestBed.tick();
    expect(p().fond).toBe('#112233');
    document.documentElement.style.setProperty('--essai-a', '#445566');
    TestBed.inject(ThemeService).basculer();
    TestBed.tick();
    expect(p().fond).toBe('#445566');
  });

  it('échoue en nommant un jeton inconnu, au lieu de peindre en noir', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'jeton-qui-nexiste-pas' });
    TestBed.tick();
    expect(() => p()).toThrow(/--jeton-qui-nexiste-pas/);
  });
});
