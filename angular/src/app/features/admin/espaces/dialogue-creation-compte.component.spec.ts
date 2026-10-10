import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { DialogueCreationCompteComponent } from './dialogue-creation-compte.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import type { EspaceResume } from './logique/types';

const URL = '/api/admin/users';
const LIEN = 'https://exemple.test/auth/v1/verify?token=initialisation-secrete-9';

function espace(id: string, nom: string, actif = true): EspaceResume {
  return { id, nom, nom_affiche: nom, slug: id, actif, interne: false, nb_membres: 0, nb_jeux_prives: 0 };
}
const ESPACES = [espace('org-b', 'BMW GROUP'), espace('org-d', 'DRHAT', false), espace('org-m', 'MARINE')];

@Component({
  imports: [DialogueCreationCompteComponent],
  template: `<mg-dialogue-creation-compte (cree)="creations = creations + 1" (fermer)="fermetures = fermetures + 1" />`,
})
class Hote {
  creations = 0;
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
      { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger: vi.fn() } },
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
  const choisirEspace = async (id: string) => {
    const s = el.querySelector<HTMLSelectElement>('select[data-espace]')!;
    s.value = id;
    s.dispatchEvent(new Event('change'));
    await f.whenStable();
  };
  const choisirRole = async (role: string) => {
    const r = el.querySelector<HTMLInputElement>(`input[type="radio"][value="${role}"]`)!;
    r.checked = true;
    r.dispatchEvent(new Event('change'));
    await f.whenStable();
  };
  const soumettre = async () => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await f.whenStable();
  };
  const bouton = () => el.querySelector<HTMLButtonElement>('[data-creer]')!;
  return { f, h: f.componentInstance, el, http, saisir, choisirEspace, choisirRole, soumettre, bouton };
}

describe('DialogueCreationCompteComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('s\'ouvre en modale ; rôle Client par défaut ; seuls les espaces ACTIFS sont proposés (le serveur refuse un inactif)', async () => {
    const { el } = await monter();
    expect(el.querySelector('dialog[open]')).not.toBeNull();
    expect(el.querySelector('h2')!.textContent!.trim()).toBe('Créer un compte');
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['client', 'super_admin']);
    expect(radios[0].checked).toBe(true);
    const options = [...el.querySelectorAll<HTMLOptionElement>('select[data-espace] option')];
    expect(options.map((o) => o.textContent!.trim())).toEqual(['Aucun', 'BMW GROUP', 'MARINE']);
  });

  it('client SANS espace : création refusée côté formulaire (bouton désactivé, aide affichée, aucun envoi)', async () => {
    const { el, http, saisir, soumettre, bouton } = await monter();
    await saisir('[data-email]', 'client@exemple.fr');
    expect(bouton().disabled).toBe(true);
    expect(el.querySelector('[data-aide-espace]')!.textContent).toContain('Un espace est obligatoire pour un compte client.');
    await soumettre();
    http.expectNone(URL);
  });

  it('client dans un espace → POST admin/users au corps EXACT ; 201 → « Compte créé » avec le lien, `cree` émis', async () => {
    const { f, el, h, http, saisir, choisirEspace, soumettre, bouton } = await monter();
    await saisir('[data-email]', '  client@exemple.fr ');
    await saisir('[data-nom]', ' Client Essai ');
    await choisirEspace('org-m');
    expect(bouton().disabled).toBe(false);
    expect(el.querySelector('[data-aide-espace]')).toBeNull();
    await soumettre();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'client@exemple.fr', full_name: 'Client Essai', role: 'client', organization_id: 'org-m' });
    req.flush({ id: 'n1', email: 'client@exemple.fr', setup_link: LIEN }, { status: 201, statusText: 'Created' });
    await f.whenStable();
    expect(el.querySelector('h2')!.textContent!.trim()).toBe('Compte créé');
    expect(el.textContent).toContain('client@exemple.fr est membre de MARINE.');
    expect(el.querySelector<HTMLInputElement>('input[data-lien-secret]')!.value).toBe(LIEN);
    expect(h.creations).toBe(1);
    expect(h.fermetures).toBe(0);
  });

  it('super_admin SANS espace → corps `role: super_admin`, `organization_id: null` ; le texte le dit', async () => {
    const { f, el, http, saisir, choisirRole, soumettre, bouton } = await monter();
    await saisir('[data-email]', 'chef@exemple.fr');
    await choisirRole('super_admin');
    expect(bouton().disabled).toBe(false);
    expect(el.querySelector('[data-aide-espace]')).toBeNull();
    await soumettre();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ email: 'chef@exemple.fr', full_name: null, role: 'super_admin', organization_id: null });
    req.flush({ id: 'n2', email: 'chef@exemple.fr', setup_link: LIEN }, { status: 201, statusText: 'Created' });
    await f.whenStable();
    expect(el.textContent).toContain('chef@exemple.fr est super admin, membre d\'aucun espace.');
  });

  it('201 SANS lien → avertissement à la place du lien', async () => {
    const { f, el, http, saisir, choisirEspace, soumettre } = await monter();
    await saisir('[data-email]', 'client@exemple.fr');
    await choisirEspace('org-b');
    await soumettre();
    http.expectOne(URL).flush({ id: 'n1', email: 'client@exemple.fr', setup_link: null }, { status: 201, statusText: 'Created' });
    await f.whenStable();
    expect(el.querySelector('input[data-lien-secret]')).toBeNull();
    expect(el.textContent).toContain('le lien n\'a pas pu être généré');
  });

  it('409 → message du serveur dans le dialogue, rien d\'émis', async () => {
    const { f, el, h, http, saisir, choisirEspace, soumettre } = await monter();
    await saisir('[data-email]', 'deja@exemple.fr');
    await choisirEspace('org-b');
    await soumettre();
    http.expectOne(URL).flush({ error: 'Un compte existe déjà avec cet e-mail.' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Un compte existe déjà avec cet e-mail.');
    expect(h.creations).toBe(0);
    expect(h.fermetures).toBe(0);
  });

  it('« Annuler » et Échap (hors envoi, avant création) émettent fermer', async () => {
    const { f, el, h } = await monter();
    el.querySelector<HTMLButtonElement>('[data-annuler]')!.click();
    await f.whenStable();
    expect(h.fermetures).toBe(1);
    const echap = new Event('cancel', { cancelable: true });
    el.querySelector('dialog')!.dispatchEvent(echap);
    expect(echap.defaultPrevented).toBe(true);
    expect(h.fermetures).toBe(2);
  });

  async function versCompteCree() {
    const m = await monter();
    await m.saisir('[data-email]', 'client@exemple.fr');
    await m.choisirEspace('org-b');
    await m.soumettre();
    m.http.expectOne(URL).flush({ id: 'n1', email: 'client@exemple.fr', setup_link: LIEN }, { status: 201, statusText: 'Created' });
    await m.f.whenStable();
    const instance = m.f.debugElement.query(By.directive(DialogueCreationCompteComponent)).componentInstance as unknown as Record<string, () => unknown>;
    return { ...m, instance };
  }

  it('« Compte créé » : ni Échap ni un clic sur le fond ne ferment ; une fermeture native forcée rouvre', async () => {
    const { f, el, h } = await versCompteCree();
    const dialog = el.querySelector('dialog')!;
    const echap = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(echap);
    expect(echap.defaultPrevented).toBe(true);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dialog.close();
    await f.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(h.fermetures).toBe(0);
    expect(el.querySelector<HTMLInputElement>('input[data-lien-secret]')!.value).toBe(LIEN);
  });

  it('« Terminer » efface le lien de l\'état puis émet fermer ; la destruction l\'efface aussi', async () => {
    const { f, el, h, instance } = await versCompteCree();
    el.querySelector<HTMLButtonElement>('[data-terminer]')!.click();
    await f.whenStable();
    expect(h.fermetures).toBe(1);
    expect(instance['compteCree']()).toBeNull();
  });

  it('jamais le lien dans la console', async () => {
    const espions = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    await versCompteCree();
    for (const e of espions) {
      for (const appel of e.mock.calls) expect(JSON.stringify(appel)).not.toContain('initialisation-secrete');
    }
  });
});
