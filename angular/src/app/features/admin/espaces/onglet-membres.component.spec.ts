import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import type { EspaceResume, MembreEspace } from './logique/types';
import { OngletMembresComponent } from './onglet-membres.component';

const URL_MEMBRES = '/api/admin/espaces/A/membres';
const URL_RETRAIT = '/api/admin/organizations/A/members';
const URL_LIEN = '/api/admin/organizations/A/members/reset-password';
const LIEN = 'https://exemple.test/auth/v1/verify?token=secret-a-usage-unique-42';

function espace(id: string, nom: string): EspaceResume {
  return { id, nom, nom_affiche: nom, slug: id, actif: true, interne: false, nb_membres: 1, nb_jeux_prives: 0 };
}
const ESPACES = [espace('A', 'Espace A'), espace('B', 'Espace B'), espace('C', 'Espace C')];

function membre(p: Partial<MembreEspace> & { id: string; email: string }): MembreEspace {
  return { nom: null, role: 'client', espace_actif: 'A', autres_espaces: [], ...p };
}

const SUPER = membre({ id: 'sa', email: 'chef@exemple.fr', nom: 'Chef', role: 'super_admin', espace_actif: 'A' });
const AILLEURS = membre({ id: 'ai', email: 'ailleurs@exemple.fr', espace_actif: 'B', autres_espaces: [{ id: 'B', nom_affiche: 'Espace B' }] });
const BASCULE = membre({
  id: 'ba', email: 'bascule@exemple.fr', espace_actif: 'A',
  autres_espaces: [{ id: 'B', nom_affiche: 'Espace B' }, { id: 'C', nom_affiche: 'Espace C' }],
});
const SEUL = membre({ id: 'se', email: 'seul@exemple.fr', espace_actif: 'A' });
const SANS_ACTIF = membre({ id: 'na', email: 'sans@exemple.fr', espace_actif: null });

@Component({
  imports: [OngletMembresComponent],
  template: `<mg-onglet-membres [espaceId]="id()" />`,
})
class Hote {
  readonly id = signal('A');
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }), configurable: true, writable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value: vi.fn(function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    }), configurable: true, writable: true,
  });
});

async function monter(membres: MembreEspace[]) {
  const recharger = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger } },
      { provide: AuthService, useValue: { session: signal({ user: { id: 'moi' } }) } },
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(Hote);
  const http = TestBed.inject(HttpTestingController);
  await f.whenStable();
  http.expectOne(URL_MEMBRES).flush({ membres });
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const onglet = f.debugElement.query(By.directive(OngletMembresComponent)).componentInstance as unknown as Record<string, () => unknown>;
  return {
    f, el, http, recharger, onglet,
    notifs: TestBed.inject(NotificationsService),
    ligne: (id: string) => el.querySelector<HTMLElement>(`[data-membre="${id}"]`),
    retirer: async (id: string) => {
      el.querySelector<HTMLButtonElement>(`[data-retirer="${id}"]`)!.click();
      await f.whenStable();
    },
    confirmation: () => el.querySelector('mg-confirmation')!,
    confirmer: () => el.querySelector<HTMLButtonElement>('mg-confirmation button.confirmer')!,
  };
}

describe('OngletMembresComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('rend chaque membre : nom, email, rôle, pastille super_admin, autres espaces, espace actif', async () => {
    const { el, ligne } = await monter([SUPER, AILLEURS, SANS_ACTIF]);
    expect(el.querySelector('[data-ajouter]')!.textContent).toContain('Ajouter un membre');
    expect(ligne('sa')!.textContent).toContain('Chef');
    expect(ligne('sa')!.textContent).toContain('chef@exemple.fr');
    expect(ligne('sa')!.textContent).toContain('Super admin');
    expect(ligne('sa')!.textContent).toContain('Voit tous les espaces');
    expect(ligne('sa')!.textContent).toContain('Espace A');
    expect(ligne('ai')!.textContent).toContain('Client');
    expect(ligne('ai')!.textContent).not.toContain('Voit tous les espaces');
    expect(ligne('ai')!.querySelector('[data-autres]')!.textContent).toContain('Espace B');
    expect(ligne('ai')!.querySelector('[data-actif]')!.textContent).toContain('Espace B');
    expect(ligne('na')!.querySelector('[data-actif]')!.textContent).toContain('Aucun (socle seul)');
    expect(ligne('na')!.textContent).toContain('Retirer de l\'espace');
    expect(ligne('na')!.textContent).toContain('Lien de mot de passe');
  });

  it('retrait d\'un super_admin : il reste super-administrateur', async () => {
    const { retirer, confirmation } = await monter([SUPER]);
    await retirer('sa');
    expect(confirmation().textContent).toContain('Retirer chef@exemple.fr de Espace A ?');
    expect(confirmation().textContent).toContain('Il reste super-administrateur et voit toujours tous les espaces.');
  });

  it('retrait d\'un espace qui n\'est pas l\'espace actif : son espace actif ne change pas', async () => {
    const { retirer, confirmation } = await monter([AILLEURS]);
    await retirer('ai');
    expect(confirmation().textContent).toContain('Son espace actif ne change pas.');
  });

  it('retrait de l\'espace actif avec d\'autres espaces : il basculera sur un de ses autres espaces', async () => {
    const { retirer, confirmation } = await monter([BASCULE]);
    await retirer('ba');
    expect(confirmation().textContent).toContain('Il basculera sur un de ses autres espaces (Espace B, Espace C).');
  });

  it('retrait de son seul espace : il ne verra plus que le socle', async () => {
    const { retirer, confirmation } = await monter([SEUL]);
    await retirer('se');
    expect(confirmation().textContent).toContain('Il ne verra plus que le socle.');
  });

  it('confirmer le retrait → DELETE au corps { userId }, puis relecture des membres et de la liste', async () => {
    const { f, http, retirer, confirmer, recharger, notifs, ligne } = await monter([SEUL, AILLEURS]);
    await retirer('se');
    confirmer().click();
    await f.whenStable();
    const req = http.expectOne(URL_RETRAIT);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ userId: 'se' });
    req.flush({ success: true });
    await f.whenStable();
    http.expectOne(URL_MEMBRES).flush({ membres: [AILLEURS] });
    await f.whenStable();
    expect(recharger).toHaveBeenCalledTimes(1);
    expect(notifs.notifications()[0]).toMatchObject({ variante: 'success' });
    expect(ligne('se')).toBeNull();
  });

  it('DELETE en 500 : notification d\'erreur, aucune relecture, ligne toujours présente', async () => {
    const { f, http, retirer, confirmer, recharger, notifs, ligne, el } = await monter([SEUL]);
    await retirer('se');
    confirmer().click();
    await f.whenStable();
    http.expectOne(URL_RETRAIT).flush({ error: 'Refusé par le serveur' }, { status: 500, statusText: 'x' });
    await f.whenStable();
    expect(notifs.notifications()[0]).toMatchObject({ titre: 'Refusé par le serveur', variante: 'error' });
    http.expectNone(URL_MEMBRES);
    expect(recharger).not.toHaveBeenCalled();
    expect(ligne('se')).not.toBeNull();
    expect(el.querySelector('mg-confirmation dialog')!.hasAttribute('open')).toBe(false);
  });

  it('lien de mot de passe : POST { email }, lien affiché ; fermer l\'efface du DOM et de l\'état, sans jamais le journaliser', async () => {
    const espions = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const { f, el, http, onglet } = await monter([SEUL]);
    el.querySelector<HTMLButtonElement>('[data-lien="se"]')!.click();
    await f.whenStable();
    const req = http.expectOne(URL_LIEN);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'seul@exemple.fr' });
    req.flush({ success: true, link: LIEN });
    await f.whenStable();
    expect(el.textContent).toContain('Lien de réinitialisation');
    expect(el.textContent).toContain('Ce lien ne sera plus affiché après fermeture.');
    const champ = el.querySelector<HTMLInputElement>('input[data-lien-secret]')!;
    expect(champ.value).toBe(LIEN);
    expect(champ.readOnly).toBe(true);
    expect(el.querySelector('[data-copier]')!.textContent).toContain('Copier');

    el.querySelector<HTMLButtonElement>('[data-fermer-lien]')!.click();
    await f.whenStable();
    expect(el.innerHTML).not.toContain('secret-a-usage-unique');
    expect(el.querySelector('input[data-lien-secret]')).toBeNull();
    expect(onglet['lien']()).toBeNull();
    for (const e of espions) {
      for (const appel of e.mock.calls) expect(JSON.stringify(appel)).not.toContain('secret-a-usage-unique');
      e.mockRestore();
    }
  });

  it('« Copier » écrit le lien dans le presse-papiers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const origine = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    onTestFinished(() => {
      if (origine) Object.defineProperty(navigator, 'clipboard', origine);
      else delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    });
    const { f, el, http } = await monter([SEUL]);
    el.querySelector<HTMLButtonElement>('[data-lien="se"]')!.click();
    await f.whenStable();
    http.expectOne(URL_LIEN).flush({ success: true, link: LIEN });
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-copier]')!.click();
    await f.whenStable();
    expect(writeText).toHaveBeenCalledWith(LIEN);
  });

  it('link: null → notification d\'erreur « Lien non généré », aucun dialogue', async () => {
    const { f, el, http, notifs } = await monter([SEUL]);
    el.querySelector<HTMLButtonElement>('[data-lien="se"]')!.click();
    await f.whenStable();
    http.expectOne(URL_LIEN).flush({ success: true, link: null });
    await f.whenStable();
    expect(notifs.notifications()[0]).toMatchObject({ titre: 'Lien non généré', variante: 'error' });
    expect(el.querySelector('input[data-lien-secret]')).toBeNull();
  });

  it('clic ou Entrée sur la ligne → fiche utilisateur ; un bouton d\'action ne l\'ouvre pas', async () => {
    const { f, el, ligne, http } = await monter([SEUL]);
    el.querySelector<HTMLButtonElement>('[data-retirer="se"]')!.click();
    await f.whenStable();
    expect(el.querySelector('mg-fiche-utilisateur')).toBeNull();
    el.querySelector<HTMLButtonElement>('mg-confirmation button.annuler')!.click();
    await f.whenStable();

    ligne('se')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await f.whenStable();
    expect(el.querySelector('mg-fiche-utilisateur')).not.toBeNull();
    expect(el.querySelector('mg-fiche-utilisateur')!.textContent).toContain('seul@exemple.fr');
    http.expectNone(() => true);
  });

  it('lecture en échec : message et « Réessayer »', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
        { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger: vi.fn() } },
        { provide: AuthService, useValue: { session: signal(null) } },
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    const f = TestBed.createComponent(Hote);
    const http = TestBed.inject(HttpTestingController);
    await f.whenStable();
    http.expectOne(URL_MEMBRES).flush({ error: 'Indisponible' }, { status: 500, statusText: 'x' });
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Indisponible');
    el.querySelector<HTMLButtonElement>('[data-reessayer]')!.click();
    await f.whenStable();
    http.expectOne(URL_MEMBRES).flush({ membres: [] });
  });
});
