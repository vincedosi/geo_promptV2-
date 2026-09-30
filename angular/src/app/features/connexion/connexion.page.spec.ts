import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { DemarrageService } from '../../core/demarrage/demarrage.service';
import { feuillesFactices } from '../../core/ressources/testing/feuilles-factices';
import { ConnexionPage } from './connexion.page';

async function rendre(opts: { erreur?: string }) {
  const feuilles = feuillesFactices();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...feuilles.providers,
      { provide: DemarrageService, useValue: { erreur: signal(opts.erreur ?? null), feuille: signal(feuilles.feuille) } },
      opts.erreur
        // Démarrage en échec : le client Supabase ne peut pas se construire.
        ? { provide: AuthService, useFactory: () => { throw new Error('Configuration pas encore chargée.'); } }
        : { provide: AuthService, useValue: { connecter: vi.fn(async () => null) } },
    ],
  });
  const f = TestBed.createComponent(ConnexionPage);
  await f.whenStable();
  // Hors de RacineDistanteComponent, la page porte sa PROPRE racine d'ombre (isolation CSS).
  const racine = (f.nativeElement as HTMLElement).shadowRoot!;
  return Object.assign(racine, { adoptions: feuilles.adoptions, feuille: feuilles.feuille });
}

describe('ConnexionPage', () => {
  it("vit dans sa propre racine d'ombre, qui adopte la feuille globale", async () => {
    const racine = await rendre({});
    expect(racine).toBeInstanceOf(ShadowRoot);
    expect(racine.adoptions).toEqual([{ racine, feuille: racine.feuille }]);
  });

  it('affiche le formulaire quand le démarrage a réussi', async () => {
    const el = await rendre({});
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('démarrage en échec : affiche l\'erreur de démarrage, JAMAIS un formulaire qui ne peut pas fonctionner', async () => {
    const el = await rendre({ erreur: 'Configuration locale introuvable. Rechargez la page pour réessayer.' });
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Configuration locale introuvable.');
  });
});
