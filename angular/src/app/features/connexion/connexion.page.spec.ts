import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { DemarrageService } from '../../core/demarrage/demarrage.service';
import { ConnexionPage } from './connexion.page';

async function rendre(opts: { erreur?: string }) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: DemarrageService, useValue: { erreur: signal(opts.erreur ?? null) } },
      opts.erreur
        // Démarrage en échec : le client Supabase ne peut pas se construire.
        ? { provide: AuthService, useFactory: () => { throw new Error('Configuration pas encore chargée.'); } }
        : { provide: AuthService, useValue: { connecter: vi.fn(async () => null) } },
    ],
  });
  const f = TestBed.createComponent(ConnexionPage);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('ConnexionPage', () => {
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
