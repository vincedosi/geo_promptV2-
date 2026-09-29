import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../config/config.service';
import { HttpBaseService } from './http-base.service';

function creer(apiBaseUrl: string) {
  TestBed.configureTestingModule({
    providers: [{ provide: ConfigService, useValue: { valeur: { apiBaseUrl } } }],
  });
  return TestBed.inject(HttpBaseService);
}

describe('HttpBaseService', () => {
  it('reste en même origine quand apiBaseUrl est vide (proxy de dev)', () => {
    expect(creer('').url('risques/sites/compter')).toBe('/api/risques/sites/compter');
  });
  it('préfixe une origine explicite, sans double barre', () => {
    expect(creer('https://magelian.exemple.test/').url('/risques/sites/compter'))
      .toBe('https://magelian.exemple.test/api/risques/sites/compter');
  });
});
