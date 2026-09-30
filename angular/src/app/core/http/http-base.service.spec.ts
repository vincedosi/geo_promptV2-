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
  it('urlAbsolue : résout une adresse relative contre la base du document', () => {
    expect(creer('').urlAbsolue('tiles/zones-risque/{z}/{x}/{y}?profil=a%20b'))
      .toBe(`${new URL(document.baseURI).origin}/api/tiles/zones-risque/{z}/{x}/{y}?profil=a%20b`);
  });
  it('urlAbsolue : garde les accolades {z}/{x}/{y} littérales', () => {
    const u = creer('').urlAbsolue('tiles/zones-risque/{z}/{x}/{y}');
    expect(u).toContain('/api/tiles/zones-risque/{z}/{x}/{y}');
    expect(u).not.toContain('%7B');
  });
  it('urlAbsolue : laisse une origine explicite intacte', () => {
    expect(creer('https://magelian.exemple.test').urlAbsolue('tiles/x/{z}'))
      .toBe('https://magelian.exemple.test/api/tiles/x/{z}');
  });
});
