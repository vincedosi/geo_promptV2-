import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { DemarrageService } from '../../core/demarrage/demarrage.service';
import { feuillesFactices } from '../../core/ressources/testing/feuilles-factices';
import { ConnexionPage } from './connexion.page';

async function rendre(opts: { erreur?: string; connecter?: () => Promise<string | null> }) {
  const feuilles = feuillesFactices();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...feuilles.providers,
      { provide: DemarrageService, useValue: { erreur: signal(opts.erreur ?? null), feuille: signal(feuilles.feuille) } },
      opts.erreur
        // Démarrage en échec : le client Supabase ne peut pas se construire.
        ? { provide: AuthService, useFactory: () => { throw new Error('Configuration pas encore chargée.'); } }
        : { provide: AuthService, useValue: { connecter: opts.connecter ?? vi.fn(async () => null) } },
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

  it("démarrage en échec : ni pied « systèmes opérationnels » ni lien d'inscription", async () => {
    const el = await rendre({ erreur: 'Configuration locale introuvable.' });
    expect(el.textContent).not.toContain('Tous les systèmes opérationnels');
    expect(el.textContent).not.toContain('Pas de compte');
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
  describe('états', () => {
    function remplir(el: ShadowRoot, email: string, mdp: string) {
      const champs = el.querySelectorAll('input');
      for (const [champ, valeur] of [[champs[0], email], [champs[1], mdp]] as const) {
        champ.value = valeur;
        champ.dispatchEvent(new Event('input'));
      }
    }

    it("repos : bouton actif « Se connecter », aucune erreur, vitrine et lien d'inscription inerte", async () => {
      const el = await rendre({});
      const bouton = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(bouton.disabled).toBe(false);
      expect(bouton.textContent?.trim()).toBe('Se connecter');
      expect(el.querySelector('[role="alert"]')).toBeNull();
      expect(el.querySelector('aside')?.textContent).toContain('Intelligence OOH en temps réel');
      expect(el.querySelectorAll('aside .font-mono').length).toBe(4);
      const inscription = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Inscription')!;
      expect(inscription.getAttribute('aria-disabled')).toBe('true');
      expect(inscription.getAttribute('title')).toBe('Disponible prochainement');
    });

    it("erreur d'identifiants : encart habillé comme React (icône + message), bouton de nouveau actif", async () => {
      const el = await rendre({ connecter: vi.fn(async () => 'Adresse ou mot de passe incorrect.') });
      remplir(el, 'a@b.fr', 'secret1');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await vi.waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toContain('incorrect'));
      const encart = el.querySelector('[role="alert"]')!.parentElement!;
      expect(encart.querySelector('mg-icone')).not.toBeNull();
      expect(encart.className).toContain('bg-danger/10');
      expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    });

    it('envoi en cours : bouton désactivé, spinner et « Connexion... »', async () => {
      let rendre_: (v: string | null) => void = () => undefined;
      const el = await rendre({ connecter: vi.fn(() => new Promise<string | null>((r) => { rendre_ = r; })) });
      remplir(el, 'a@b.fr', 'secret1');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await vi.waitFor(() => expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true));
      const bouton = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(bouton.textContent).toContain('Connexion...');
      expect(bouton.querySelector('svg.animate-spin')).not.toBeNull();
      rendre_('Adresse ou mot de passe incorrect.');
    });

    it('champs vides : rien ne part (comme React)', async () => {
      const connecter = vi.fn(async () => null);
      const el = await rendre({ connecter });
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await Promise.resolve();
      expect(connecter).not.toHaveBeenCalled();
    });

    it("œil : bascule le type du champ ; « Mot de passe oublié ? » ouvre l'encart d'aide", async () => {
      const el = await rendre({});
      const mdp = el.querySelectorAll('input')[1];
      expect(mdp.type).toBe('password');
      const oeil = [...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Afficher le mot de passe')!;
      oeil.click();
      await vi.waitFor(() => expect(el.querySelectorAll('input')[1].type).toBe('text'));
      expect(el.textContent).not.toContain('Demandez un lien');
      [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('oublié'))!.click();
      await vi.waitFor(() => expect(el.textContent).toContain('Demandez un lien de réinitialisation'));
    });
  });
});
