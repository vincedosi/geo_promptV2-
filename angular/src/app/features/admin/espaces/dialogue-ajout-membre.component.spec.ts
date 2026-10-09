import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { type CompteAdmin, EspacesApi } from './data/espaces.api';
import { DialogueAjoutMembreComponent } from './dialogue-ajout-membre.component';

const URL_COMPTES = '/api/admin/users';
const LIEN = 'https://exemple.test/auth/v1/verify?token=initialisation-secrete-7';

function compte(id: string, email: string): CompteAdmin {
  return { id, email, full_name: null, role: 'client', organization_id: null };
}
const COMPTES = [compte('u1', 'deja@exemple.fr'), compte('u2', 'libre@exemple.fr'), compte('u3', 'autre@exemple.fr')];

@Component({
  imports: [DialogueAjoutMembreComponent],
  template: `<mg-dialogue-ajout-membre espaceId="A" [membresIds]="['u1']" (ajoute)="ajouts = ajouts + 1" (fermer)="fermetures = fermetures + 1" />`,
})
class Hote {
  ajouts = 0;
  fermetures = 0;
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

async function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(Hote);
  const http = TestBed.inject(HttpTestingController);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const saisir = async (selecteur: string, valeur: string) => {
    const champ = el.querySelector<HTMLInputElement>(selecteur)!;
    champ.value = valeur;
    champ.dispatchEvent(new Event('input'));
    await f.whenStable();
  };
  const nouveauCompte = async () => {
    el.querySelector<HTMLButtonElement>('[data-mode="nouveau"]')!.click();
    await f.whenStable();
  };
  const soumettreNouveau = async () => {
    el.querySelector('form[data-nouveau]')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await f.whenStable();
  };
  return { f, h: f.componentInstance, el, http, saisir, nouveauCompte, soumettreNouveau };
}

describe('DialogueAjoutMembreComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('un seul GET des comptes, même après deux frappes ; un compte déjà membre n\'est pas proposé', async () => {
    const { el, http, saisir } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await saisir('[data-recherche]', 'e');
    await saisir('[data-recherche]', 'ex');
    http.expectNone(URL_COMPTES);
    const propositions = [...el.querySelectorAll('[data-compte]')].map((b) => b.textContent);
    expect(propositions.join(' ')).toContain('libre@exemple.fr');
    expect(propositions.join(' ')).toContain('autre@exemple.fr');
    expect(propositions.join(' ')).not.toContain('deja@exemple.fr');
    await saisir('[data-recherche]', 'LIB');
    expect(el.querySelectorAll('[data-compte]')).toHaveLength(1);
  });

  it('choisir un compte existant → POST members au corps { email } (sans rôle), puis ajoute et fermer', async () => {
    const { f, el, h, http } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-compte="u2"]')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/organizations/A/members');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'libre@exemple.fr' });
    req.flush({ success: true });
    await f.whenStable();
    expect(h.ajouts).toBe(1);
    expect(h.fermetures).toBe(1);
  });

  it('ajout refusé : message du serveur dans le dialogue, rien d\'émis', async () => {
    const { f, el, h, http } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-compte="u2"]')!.click();
    await f.whenStable();
    http.expectOne('/api/admin/organizations/A/members').flush({ error: 'Espace inactif' }, { status: 400, statusText: 'x' });
    await f.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Espace inactif');
    expect(h.ajouts).toBe(0);
    expect(h.fermetures).toBe(0);
  });

  it('nouveau compte → POST admin/users au corps EXACT ; 201 avec lien → écran « Compte créé »', async () => {
    const espions = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const { f, el, h, http, saisir, nouveauCompte, soumettreNouveau } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await nouveauCompte();
    expect(el.textContent).not.toContain('Super admin');
    await saisir('[data-email]', ' nom@exemple.fr ');
    await soumettreNouveau();
    const req = http.expectOne((r) => r.url === URL_COMPTES && r.method === 'POST');
    expect(req.request.body).toEqual({ email: 'nom@exemple.fr', full_name: null, role: 'client', organization_id: 'A' });
    req.flush({ id: 'n1', email: 'nom@exemple.fr', setup_link: LIEN }, { status: 201, statusText: 'Created' });
    await f.whenStable();
    expect(el.textContent).toContain('Compte créé');
    expect(el.querySelector<HTMLInputElement>('input[data-lien-secret]')!.value).toBe(LIEN);
    expect(el.textContent).toContain('Transmettez ce lien à la personne : il ne sera plus affiché.');
    expect(h.ajouts).toBe(1);
    expect(h.fermetures).toBe(0);
    for (const e of espions) {
      for (const appel of e.mock.calls) expect(JSON.stringify(appel)).not.toContain('initialisation-secrete');
      e.mockRestore();
    }
  });

  it('201 sans lien → message de repli', async () => {
    const { f, el, http, saisir, nouveauCompte, soumettreNouveau } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await nouveauCompte();
    await saisir('[data-email]', 'nom@exemple.fr');
    await saisir('[data-nom]', 'Prénom Nom');
    await soumettreNouveau();
    const req = http.expectOne((r) => r.url === URL_COMPTES && r.method === 'POST');
    expect(req.request.body).toEqual({ email: 'nom@exemple.fr', full_name: 'Prénom Nom', role: 'client', organization_id: 'A' });
    req.flush({ id: 'n1', email: 'nom@exemple.fr', setup_link: null }, { status: 201, statusText: 'Created' });
    await f.whenStable();
    expect(el.textContent).toContain('Le compte est créé, mais le lien n\'a pas pu être généré. Générez-en un avec « Lien de mot de passe ».');
    expect(el.querySelector('input[data-lien-secret]')).toBeNull();
  });

  it('409 → « Ce compte existe déjà : ajoutez-le depuis « Compte existant ». » dans le dialogue', async () => {
    const { f, el, h, http, saisir, nouveauCompte, soumettreNouveau } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await nouveauCompte();
    await saisir('[data-email]', 'deja@exemple.fr');
    await soumettreNouveau();
    http.expectOne((r) => r.url === URL_COMPTES && r.method === 'POST').flush({ error: 'exists' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Ce compte existe déjà : ajoutez-le depuis « Compte existant ».');
    expect(h.ajouts).toBe(0);
  });

  it('fermer l\'écran « Compte créé » émet fermer', async () => {
    const { f, el, h, http, saisir, nouveauCompte, soumettreNouveau } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await nouveauCompte();
    await saisir('[data-email]', 'nom@exemple.fr');
    await soumettreNouveau();
    http.expectOne((r) => r.url === URL_COMPTES && r.method === 'POST').flush({ id: 'n1', email: 'nom@exemple.fr', setup_link: LIEN }, { status: 201, statusText: 'Created' });
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-terminer]')!.click();
    await f.whenStable();
    expect(h.fermetures).toBe(1);
  });

  it('fermeture native forcée pendant un ajout : le parent relit quand même (ajoute puis fermer)', async () => {
    const { f, el, h, http } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-compte="u2"]')!.click();
    await f.whenStable();
    http.expectOne('/api/admin/organizations/A/members');
    el.querySelector('dialog')!.dispatchEvent(new Event('close'));
    await f.whenStable();
    expect(h.ajouts).toBe(1);
    expect(h.fermetures).toBe(1);
  });

  it('fermeture native forcée pendant une création : ajoute est émis', async () => {
    const { f, el, h, http, saisir, nouveauCompte, soumettreNouveau } = await monter();
    http.expectOne(URL_COMPTES).flush(COMPTES);
    await nouveauCompte();
    await saisir('[data-email]', 'nom@exemple.fr');
    await soumettreNouveau();
    http.expectOne((r) => r.url === URL_COMPTES && r.method === 'POST');
    el.querySelector('dialog')!.dispatchEvent(new Event('close'));
    await f.whenStable();
    expect(h.ajouts).toBe(1);
    expect(h.fermetures).toBe(1);
  });

  async function versCompteCree() {
    const m = await monter();
    m.http.expectOne(URL_COMPTES).flush(COMPTES);
    await m.nouveauCompte();
    await m.saisir('[data-email]', 'nom@exemple.fr');
    await m.soumettreNouveau();
    m.http.expectOne((r) => r.url === URL_COMPTES && r.method === 'POST')
      .flush({ id: 'n1', email: 'nom@exemple.fr', setup_link: LIEN }, { status: 201, statusText: 'Created' });
    await m.f.whenStable();
    const instance = m.f.debugElement.query(By.directive(DialogueAjoutMembreComponent)).componentInstance as unknown as Record<string, () => unknown>;
    return { ...m, instance };
  }

  it('« Compte créé » : ni Échap ni un clic sur le fond ne ferment, le lien reste affiché', async () => {
    const { f, el, h } = await versCompteCree();
    const dialog = el.querySelector('dialog')!;
    const echap = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(echap);
    expect(echap.defaultPrevented).toBe(true);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await f.whenStable();
    expect(h.fermetures).toBe(0);
    expect(el.querySelector<HTMLInputElement>('input[data-lien-secret]')!.value).toBe(LIEN);
  });

  it('« Compte créé » : fermeture native forcée → le dialogue se rouvre, le lien reste', async () => {
    const { f, el, h } = await versCompteCree();
    const dialog = el.querySelector('dialog')!;
    dialog.close();
    await f.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(h.fermetures).toBe(0);
    expect(el.querySelector<HTMLInputElement>('input[data-lien-secret]')!.value).toBe(LIEN);
  });

  it('« Terminer » efface le lien de l\'état puis émet fermer', async () => {
    const { f, el, h, instance } = await versCompteCree();
    el.querySelector<HTMLButtonElement>('[data-terminer]')!.click();
    await f.whenStable();
    expect(h.fermetures).toBe(1);
    expect(instance['compteCree']()).toBeNull();
  });

  it('la destruction efface le lien de l\'état', async () => {
    const { f, instance } = await versCompteCree();
    expect(instance['compteCree']()).not.toBeNull();
    f.destroy();
    expect(instance['compteCree']()).toBeNull();
  });
});
