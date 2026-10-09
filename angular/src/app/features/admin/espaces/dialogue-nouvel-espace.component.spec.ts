import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { EspacesApi } from './data/espaces.api';
import { DialogueNouvelEspaceComponent, type EspaceCree } from './dialogue-nouvel-espace.component';
import { LONGUEUR_MAX_DESCRIPTION } from './logique/libelles';

@Component({
  imports: [DialogueNouvelEspaceComponent],
  template: `
    <div (keydown)="touchesVuesParLaPage = touchesVuesParLaPage + 1">
      <mg-dialogue-nouvel-espace (creer)="crees.push($event)" (annuler)="annulations = annulations + 1" />
    </div>
  `,
})
class Hote {
  crees: EspaceCree[] = [];
  annulations = 0;
  touchesVuesParLaPage = 0;
}

/** jsdom n'implémente ni `showModal` ni `close` : doublures (patron de `confirmation.component.spec.ts`). */
let showModal: ReturnType<typeof vi.fn>;
beforeEach(() => {
  showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  const close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true, writable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: close, configurable: true, writable: true });
});

async function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(Hote);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const saisir = async (selecteur: string, valeur: string) => {
    const champ = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selecteur)!;
    champ.value = valeur;
    champ.dispatchEvent(new Event('input'));
    await f.whenStable();
  };
  const creer = () => el.querySelector<HTMLButtonElement>('[data-creer]')!;
  const soumettre = async () => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await f.whenStable();
  };
  return { f, h: f.componentInstance, el, http, dialog: el.querySelector('dialog')!, saisir, creer, soumettre };
}

describe('DialogueNouvelEspaceComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('s\'ouvre en modale à l\'affichage, avec « Nom », « Description », « Annuler » et « Créer l\'espace »', async () => {
    const { el, dialog } = await monter();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(el.querySelector('[data-nom]')).not.toBeNull();
    expect(el.querySelector('[data-description]')).not.toBeNull();
    expect(el.textContent).toContain('Nom');
    expect(el.textContent).toContain('Description');
    expect(el.querySelector('[data-annuler]')?.textContent?.trim()).toBe('Annuler');
    expect(el.querySelector('[data-creer]')?.textContent?.trim()).toBe('Créer l\'espace');
  });

  it('description : même longueur maximale qu\'à l\'onglet Réglages (une seule constante)', async () => {
    const { el } = await monter();
    expect(el.querySelector('[data-description]')!.getAttribute('maxlength')).toBe(String(LONGUEUR_MAX_DESCRIPTION));
  });

  it('nom vide ou fait de blancs → « Créer l\'espace » désactivé, et un envoi forcé ne part pas', async () => {
    const { creer, saisir, soumettre, http } = await monter();
    expect(creer().disabled).toBe(true);
    await saisir('[data-nom]', '   ');
    expect(creer().disabled).toBe(true);
    await soumettre();
    http.expectNone('/api/admin/organizations');
    await saisir('[data-nom]', 'Espace test');
    expect(creer().disabled).toBe(false);
  });

  it('saisie « Espace test » → POST au corps { name: \'Espace test\' } ; succès → `creer` émis avec l\'id', async () => {
    const { h, saisir, soumettre, http, f } = await monter();
    await saisir('[data-nom]', '  Espace test ');
    await soumettre();
    const post = http.expectOne('/api/admin/organizations');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ name: 'Espace test' });
    post.flush({ success: true, organization: { id: 'org-9' } });
    await f.whenStable();
    expect(h.crees).toEqual([{ id: 'org-9', descriptionPerdue: false }]);
  });

  it('avec une description : POST puis PATCH { description } ; `creer` émis après le PATCH', async () => {
    const { h, saisir, soumettre, http, f } = await monter();
    await saisir('[data-nom]', 'Espace test');
    await saisir('[data-description]', '  Pour les essais ');
    await soumettre();
    http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-9' } });
    expect(h.crees).toEqual([]);
    const patch = http.expectOne('/api/admin/organizations/org-9');
    expect(patch.request.body).toEqual({ description: 'Pour les essais' });
    patch.flush({ success: true, organization: { id: 'org-9' } });
    await f.whenStable();
    expect(h.crees).toEqual([{ id: 'org-9', descriptionPerdue: false }]);
  });

  it('PATCH en échec : l\'espace existe → `creer` émis quand même, `descriptionPerdue: true`', async () => {
    const { h, saisir, soumettre, http, f } = await monter();
    await saisir('[data-nom]', 'Espace test');
    await saisir('[data-description]', 'Texte');
    await soumettre();
    http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-9' } });
    http.expectOne('/api/admin/organizations/org-9').flush({ error: 'boum' }, { status: 500, statusText: 'Server Error' });
    await f.whenStable();
    expect(h.crees).toEqual([{ id: 'org-9', descriptionPerdue: true }]);
  });

  it('pendant l\'envoi : bouton désactivé, « Création… », un second envoi ne part pas', async () => {
    const { creer, saisir, soumettre, http } = await monter();
    await saisir('[data-nom]', 'Espace test');
    await soumettre();
    expect(creer().disabled).toBe(true);
    expect(creer().textContent?.trim()).toBe('Création…');
    await soumettre();
    http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-9' } });
  });

  it('409 → le message du serveur est rendu DANS le dialogue (role="alert"), qui reste ouvert', async () => {
    const { h, el, dialog, saisir, soumettre, http, f, creer } = await monter();
    await saisir('[data-nom]', 'BMW GROUP');
    await soumettre();
    http.expectOne('/api/admin/organizations').flush(
      { success: false, error: 'Une organisation avec ce nom existe deja' },
      { status: 409, statusText: 'Conflict' },
    );
    await f.whenStable();
    const alerte = dialog.querySelector('[role="alert"]');
    expect(alerte?.textContent?.trim()).toBe('Une organisation avec ce nom existe deja');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(h.crees).toEqual([]);
    expect(h.annulations).toBe(0);
    expect(creer().disabled).toBe(false);
    // Corriger le nom efface le message.
    await saisir('[data-nom]', 'Autre nom');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('Échap → `annuler` émis (comportement de mg-confirmation), la touche ne remonte pas à la page', async () => {
    const { h, dialog } = await monter();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(h.annulations).toBe(1);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.touchesVuesParLaPage).toBe(0);
  });

  it('« Annuler » → `annuler` émis', async () => {
    const { h, el } = await monter();
    el.querySelector<HTMLButtonElement>('[data-annuler]')!.click();
    expect(h.annulations).toBe(1);
  });

  it('pendant l\'envoi, Échap n\'annule pas', async () => {
    const { h, dialog, saisir, soumettre, http } = await monter();
    await saisir('[data-nom]', 'Espace test');
    await soumettre();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(h.annulations).toBe(0);
    http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-9' } });
  });
});
