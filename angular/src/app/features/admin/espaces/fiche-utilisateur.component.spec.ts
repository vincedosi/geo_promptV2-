import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { FicheUtilisateurComponent } from './fiche-utilisateur.component';
import type { EspaceResume, MembreEspace } from './logique/types';

function espace(id: string, nom: string): EspaceResume {
  return { id, nom, nom_affiche: nom, slug: id, actif: true, interne: false, nb_membres: 1, nb_jeux_prives: 0 };
}
const ESPACES = [espace('A', 'Espace A'), espace('B', 'Espace B'), espace('C', 'Espace C')];

const MEMBRE: MembreEspace = {
  id: 'U', email: 'personne@exemple.fr', nom: 'Personne', role: 'client', espace_actif: 'A',
  autres_espaces: [{ id: 'B', nom_affiche: 'Espace B' }],
};

@Component({
  imports: [FicheUtilisateurComponent],
  template: `<mg-fiche-utilisateur [membre]="membre" espaceId="A" (fermer)="fermetures.push($event)" />`,
})
class Hote {
  membre = MEMBRE;
  fermetures: boolean[] = [];
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

async function monter(moi = 'moi', membre: MembreEspace = MEMBRE) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger: vi.fn() } },
      { provide: AuthService, useValue: { session: signal({ user: { id: moi } }) } },
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(Hote);
  f.componentInstance.membre = membre;
  const http = TestBed.inject(HttpTestingController);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const fiche = () => el.querySelector('mg-fiche-utilisateur > dialog')!;
  const caseEspace = (id: string) => el.querySelector<HTMLInputElement>(`input[data-espace="${id}"]`)!;
  const selectActif = () => el.querySelector<HTMLSelectElement>('select[data-actif]')!;
  const basculer = async (id: string, coche: boolean) => {
    const c = caseEspace(id);
    c.checked = coche;
    c.dispatchEvent(new Event('change'));
    await f.whenStable();
  };
  const actifChoisi = () => selectActif().selectedOptions[0]?.value;
  return { f, el, http, h: f.componentInstance, fiche, caseEspace, selectActif, basculer, actifChoisi, notifs: TestBed.inject(NotificationsService) };
}

describe('FicheUtilisateurComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('affiche l\'email, le nom, deux rôles seulement (jamais admin), les espaces cochés et l\'espace actif', async () => {
    const { el, caseEspace, actifChoisi, selectActif } = await monter();
    expect(el.textContent).toContain('personne@exemple.fr');
    expect(el.querySelector<HTMLInputElement>('input[data-nom]')!.value).toBe('Personne');
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['client', 'super_admin']);
    expect(el.querySelector('input[type="radio"][value="admin"]')).toBeNull();
    expect(el.textContent).toContain('Client');
    expect(el.textContent).toContain('Super admin');
    expect(radios[0].checked).toBe(true);
    expect(caseEspace('A').checked).toBe(true);
    expect(caseEspace('B').checked).toBe(true);
    expect(caseEspace('C').checked).toBe(false);
    expect(actifChoisi()).toBe('A');
    expect([...selectActif().options].map((o) => o.textContent!.trim())).toEqual(['Espace A', 'Espace B', 'Aucun (socle seul)']);
  });

  it('décocher l\'espace actif → le choix passe au premier coché restant, puis à « Aucun »', async () => {
    const { basculer, actifChoisi } = await monter();
    await basculer('A', false);
    expect(actifChoisi()).toBe('B');
    await basculer('B', false);
    expect(actifChoisi()).toBe('');
  });

  it('« Enregistrer les espaces » → PUT au corps EXACT, puis fermer signale une écriture', async () => {
    const { f, el, http, h, basculer } = await monter();
    await basculer('C', true);
    el.querySelector<HTMLButtonElement>('[data-enregistrer-espaces]')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/users/U/espaces');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ espaces: ['A', 'B', 'C'], espace_actif: 'A' });
    req.flush({ espaces: ['A', 'B', 'C'], espace_actif: 'A' });
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-fermer]')!.click();
    await f.whenStable();
    expect(h.fermetures).toEqual([true]);
  });

  it('PUT en 400 → message du serveur dans la fiche', async () => {
    const { f, el, http } = await monter();
    el.querySelector<HTMLButtonElement>('[data-enregistrer-espaces]')!.click();
    await f.whenStable();
    http.expectOne('/api/admin/users/U/espaces').flush(
      { error: 'L\'espace actif doit faire partie des espaces de l\'utilisateur.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await f.whenStable();
    expect(el.querySelector('[data-erreur-espaces]')!.textContent).toContain('L\'espace actif doit faire partie des espaces de l\'utilisateur.');
  });

  it('fermer sans écriture → fermer(false)', async () => {
    const { f, el, h } = await monter();
    el.querySelector<HTMLButtonElement>('[data-fermer]')!.click();
    await f.whenStable();
    expect(h.fermetures).toEqual([false]);
  });

  it('passer à super_admin → confirmation, puis PATCH { role: \'super_admin\' }', async () => {
    const { f, el, http } = await monter();
    const radio = el.querySelector<HTMLInputElement>('input[type="radio"][value="super_admin"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await f.whenStable();
    http.expectNone('/api/admin/users/U');
    const conf = el.querySelector('mg-confirmation[data-confirmation-role]')!;
    expect(conf.textContent).toContain('personne@exemple.fr verra les données de tous les espaces, quel que soit son espace actif.');
    expect(radio.checked).toBe(false);
    conf.querySelector<HTMLButtonElement>('button.confirmer')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/users/U');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ role: 'super_admin' });
    req.flush({ success: true });
    await f.whenStable();
    expect(radio.checked).toBe(true);
  });

  it('PATCH du rôle refusé : le rôle affiché reste client et l\'erreur se voit', async () => {
    const { f, el, http, notifs } = await monter();
    const radio = el.querySelector<HTMLInputElement>('input[type="radio"][value="super_admin"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('mg-confirmation[data-confirmation-role] button.confirmer')!.click();
    await f.whenStable();
    http.expectOne('/api/admin/users/U').flush({ error: 'Refusé' }, { status: 403, statusText: 'x' });
    await f.whenStable();
    expect(notifs.notifications()[0]).toMatchObject({ titre: 'Refusé', variante: 'error' });
    expect(radio.checked).toBe(false);
    expect(el.querySelector<HTMLInputElement>('input[type="radio"][value="client"]')!.checked).toBe(true);
  });

  it('enregistrer le nom → PATCH { full_name }', async () => {
    const { f, el, http } = await monter();
    const champ = el.querySelector<HTMLInputElement>('input[data-nom]')!;
    champ.value = '  Nouveau nom ';
    champ.dispatchEvent(new Event('input'));
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-enregistrer-nom]')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/users/U');
    expect(req.request.body).toEqual({ full_name: 'Nouveau nom' });
    req.flush({ success: true });
  });

  it('« Supprimer le compte » : confirmation danger puis DELETE ; fermer(true)', async () => {
    const { f, el, http, h } = await monter();
    el.querySelector<HTMLButtonElement>('[data-supprimer]')!.click();
    await f.whenStable();
    const conf = el.querySelector('mg-confirmation[data-confirmation-suppression]')!;
    expect(conf.textContent).toContain('Supprimer définitivement personne@exemple.fr ?');
    expect(conf.textContent).toContain('Ses zones et jeux de zones restent en base, sans auteur.');
    conf.querySelector<HTMLButtonElement>('button.confirmer')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/users/U');
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true });
    await f.whenStable();
    expect(h.fermetures).toEqual([true]);
  });

  it('« Supprimer le compte » désactivé sur son propre compte', async () => {
    const { el } = await monter('U');
    expect(el.querySelector<HTMLButtonElement>('[data-supprimer]')!.disabled).toBe(true);
  });

  it('fermeture native forcée pendant une écriture → fermer(true), le parent relit', async () => {
    const { f, el, http, h } = await monter();
    el.querySelector<HTMLButtonElement>('[data-enregistrer-espaces]')!.click();
    await f.whenStable();
    http.expectOne('/api/admin/users/U/espaces');
    el.querySelector('mg-fiche-utilisateur > dialog')!.dispatchEvent(new Event('close'));
    await f.whenStable();
    expect(h.fermetures).toEqual([true]);
  });

  it('rétrograder un super_admin : confirmation danger, annuler remet le radio, confirmer → PATCH { role: \'client\' }', async () => {
    const chef: MembreEspace = { ...MEMBRE, role: 'super_admin' };
    const { f, el, http } = await monter('moi', chef);
    const client = el.querySelector<HTMLInputElement>('input[type="radio"][value="client"]')!;
    const sa = el.querySelector<HTMLInputElement>('input[type="radio"][value="super_admin"]')!;
    expect(sa.checked).toBe(true);
    client.checked = true;
    client.dispatchEvent(new Event('change'));
    await f.whenStable();
    http.expectNone('/api/admin/users/U');
    const conf = el.querySelector('mg-confirmation[data-confirmation-role]')!;
    expect(conf.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    expect(conf.textContent).toContain('personne@exemple.fr ne verra plus tous les espaces : il ne gardera que ceux dont il est membre.');
    expect(conf.querySelector('button.confirmer')!.classList).toContain('danger');
    expect(sa.checked).toBe(true);

    conf.querySelector<HTMLButtonElement>('button.annuler')!.click();
    await f.whenStable();
    expect(conf.querySelector('dialog')!.hasAttribute('open')).toBe(false);
    expect(sa.checked).toBe(true);
    expect(client.checked).toBe(false);
    http.expectNone('/api/admin/users/U');

    client.checked = true;
    client.dispatchEvent(new Event('change'));
    await f.whenStable();
    conf.querySelector<HTMLButtonElement>('button.confirmer')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/users/U');
    expect(req.request.body).toEqual({ role: 'client' });
    req.flush({ success: true });
    await f.whenStable();
    expect(client.checked).toBe(true);
  });

  it('membre au rôle admin : son rôle actuel est affiché et coché, entre Client et Super admin', async () => {
    const { el } = await monter('moi', { ...MEMBRE, role: 'admin' });
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['client', 'admin', 'super_admin']);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    expect(radios[1].closest('label')!.textContent).toContain('Admin');
  });

  it('admin → client : confirmation propre à cette transition (pas le texte du super-admin), puis PATCH ; « Admin » disparaît', async () => {
    const { f, el, http } = await monter('moi', { ...MEMBRE, role: 'admin' });
    const client = el.querySelector<HTMLInputElement>('input[type="radio"][value="client"]')!;
    client.checked = true;
    client.dispatchEvent(new Event('change'));
    await f.whenStable();
    http.expectNone('/api/admin/users/U');
    const conf = el.querySelector('mg-confirmation[data-confirmation-role]')!;
    expect(conf.textContent).toContain('Passer au rôle Client ?');
    expect(conf.textContent).toContain('personne@exemple.fr perd le rôle Admin');
    expect(conf.textContent).not.toContain('super-administrateur');
    expect(conf.textContent).not.toContain('ne verra plus tous les espaces');
    expect(el.querySelector<HTMLInputElement>('input[type="radio"][value="admin"]')!.checked).toBe(true);
    conf.querySelector<HTMLButtonElement>('button.confirmer')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/users/U');
    expect(req.request.body).toEqual({ role: 'client' });
    req.flush({ success: true });
    await f.whenStable();
    // E5 : `admin` n'est jamais proposé ; une fois quitté, il n'est plus affiché.
    expect([...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.value)).toEqual(['client', 'super_admin']);
    expect(el.querySelector<HTMLInputElement>('input[type="radio"][value="client"]')!.checked).toBe(true);
  });

  it('admin → super_admin : la confirmation « Nommer super-administrateur »', async () => {
    const { f, el } = await monter('moi', { ...MEMBRE, role: 'admin' });
    const sa = el.querySelector<HTMLInputElement>('input[type="radio"][value="super_admin"]')!;
    sa.checked = true;
    sa.dispatchEvent(new Event('change'));
    await f.whenStable();
    const conf = el.querySelector('mg-confirmation[data-confirmation-role]')!;
    expect(conf.textContent).toContain('Nommer super-administrateur ?');
    conf.querySelector<HTMLButtonElement>('button.annuler')!.click();
    await f.whenStable();
    expect(el.querySelector<HTMLInputElement>('input[type="radio"][value="admin"]')!.checked).toBe(true);
  });

  it('son propre compte : les radios de rôle sont désactivés', async () => {
    const { el } = await monter('U');
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r.disabled).toBe(true);
  });
});

/** Ouverte depuis « Tous les comptes » : AUCUN espace courant, `autres_espaces` = tous ses espaces. */
@Component({
  imports: [FicheUtilisateurComponent],
  template: `<mg-fiche-utilisateur [membre]="membre" (fermer)="fermetures.push($event)" />`,
})
class HoteSansEspace {
  membre: MembreEspace = MEMBRE;
  fermetures: boolean[] = [];
}

async function monterSansEspace(membre: MembreEspace) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger: vi.fn() } },
      { provide: AuthService, useValue: { session: signal({ user: { id: 'moi' } }) } },
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(HoteSansEspace);
  f.componentInstance.membre = membre;
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return {
    f, el, http: TestBed.inject(HttpTestingController),
    caseEspace: (id: string) => el.querySelector<HTMLInputElement>(`input[data-espace="${id}"]`)!,
    selectActif: () => el.querySelector<HTMLSelectElement>('select[data-actif]')!,
  };
}

describe('FicheUtilisateurComponent — sans espace courant (vue « Tous les comptes »)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('compte rattaché à AUCUN espace : aucune case cochée, « Aucun (socle seul) » choisi', async () => {
    const { el, caseEspace, selectActif } = await monterSansEspace({ ...MEMBRE, espace_actif: null, autres_espaces: [] });
    expect(el.querySelector('mg-fiche-utilisateur > dialog[open]')).not.toBeNull();
    for (const id of ['A', 'B', 'C']) expect(caseEspace(id).checked).toBe(false);
    expect([...selectActif().options].map((o) => o.textContent!.trim())).toEqual(['Aucun (socle seul)']);
    expect(selectActif().selectedOptions[0].value).toBe('');
  });

  it('les cases cochées viennent de la liste COMPLÈTE de ses espaces ; l\'espace actif est le sien', async () => {
    const { caseEspace, selectActif } = await monterSansEspace({
      ...MEMBRE, espace_actif: 'C', autres_espaces: [{ id: 'B', nom_affiche: 'Espace B' }, { id: 'C', nom_affiche: 'Espace C' }],
    });
    expect(caseEspace('A').checked).toBe(false);
    expect(caseEspace('B').checked).toBe(true);
    expect(caseEspace('C').checked).toBe(true);
    expect(selectActif().selectedOptions[0].value).toBe('C');
  });

  it('rattacher un compte sans espace : PUT au corps EXACT (le seul espace coché, actif « Aucun »)', async () => {
    const { f, el, http, caseEspace } = await monterSansEspace({ ...MEMBRE, espace_actif: null, autres_espaces: [] });
    const c = caseEspace('B');
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    await f.whenStable();
    el.querySelector<HTMLButtonElement>('[data-enregistrer-espaces]')!.click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/users/U/espaces');
    expect(req.request.body).toEqual({ espaces: ['B'], espace_actif: null });
    req.flush({ espaces: ['B'], espace_actif: 'B' });
    await f.whenStable();
    expect(caseEspace('B').checked).toBe(true);
  });
});

describe('FicheUtilisateurComponent — lien de mot de passe', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const URL_LIEN = '/api/admin/users/U/lien-mot-de-passe';
  const LIEN = 'http://127.0.0.1:54321/auth/v1/verify?token=secret-de-la-fiche&type=recovery';

  it('pour un compte SANS espace : POST par identifiant, lien affiché ; fermer l\'efface, jamais journalisé', async () => {
    const espions = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const { f, el, http } = await monterSansEspace({ ...MEMBRE, espace_actif: null, autres_espaces: [] });
    const bouton = el.querySelector<HTMLButtonElement>('[data-lien-mot-de-passe]')!;
    expect(bouton.textContent).toContain('Lien de mot de passe');
    bouton.click();
    await f.whenStable();
    expect(bouton.disabled).toBe(true);
    const req = http.expectOne(URL_LIEN);
    expect(req.request.method).toBe('POST');
    req.flush({ lien: LIEN });
    await f.whenStable();
    expect(el.querySelector('mg-dialogue-lien')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('mg-dialogue-lien input[data-lien-secret]')!.value).toBe(LIEN);
    expect(el.querySelector('mg-dialogue-lien')!.textContent).toContain('personne@exemple.fr');

    el.querySelector<HTMLButtonElement>('[data-fermer-lien]')!.click();
    await f.whenStable();
    expect(el.querySelector('mg-dialogue-lien')).toBeNull();
    expect(el.innerHTML).not.toContain('secret-de-la-fiche');
    // La fiche reste ouverte : seul le dialogue du lien s'est fermé.
    expect(el.querySelector('mg-fiche-utilisateur > dialog')!.hasAttribute('open')).toBe(true);
    // Le dialogue du lien est retiré du DOM : le focus revient au bouton, pas au <body>.
    expect(document.activeElement).toBe(bouton);
    for (const e of espions) {
      for (const appel of e.mock.calls) expect(JSON.stringify(appel)).not.toContain('secret-de-la-fiche');
      e.mockRestore();
    }
  });

  it('échec (404) : notification du message du serveur, aucun dialogue, bouton réactivé', async () => {
    const { f, el, http } = await monterSansEspace(MEMBRE);
    el.querySelector<HTMLButtonElement>('[data-lien-mot-de-passe]')!.click();
    await f.whenStable();
    http.expectOne(URL_LIEN).flush({ error: 'Compte introuvable.' }, { status: 404, statusText: 'Not Found' });
    await f.whenStable();
    const notifs = TestBed.inject(NotificationsService).notifications();
    expect(notifs[0]).toMatchObject({ variante: 'error' });
    expect(JSON.stringify(notifs[0])).toContain('Compte introuvable.');
    expect(el.querySelector('mg-dialogue-lien')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-lien-mot-de-passe]')!.disabled).toBe(false);
  });

  it('pendant la génération : « Supprimer le compte » désactivé, « Fermer » reste possible', async () => {
    const { f, el, http } = await monterSansEspace(MEMBRE);
    el.querySelector<HTMLButtonElement>('[data-lien-mot-de-passe]')!.click();
    await f.whenStable();
    const req = http.expectOne(URL_LIEN);
    expect(el.querySelector<HTMLButtonElement>('[data-supprimer]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-fermer]')!.disabled).toBe(false);
    req.flush({ lien: 'https://exemple.test/lien' });
    await f.whenStable();
    expect(el.querySelector<HTMLButtonElement>('[data-supprimer]')!.disabled).toBe(false);
  });

  it('fermer la fiche pendant la génération abandonne la requête', async () => {
    const { f, el, http } = await monterSansEspace(MEMBRE);
    el.querySelector<HTMLButtonElement>('[data-lien-mot-de-passe]')!.click();
    await f.whenStable();
    const req = http.expectOne(URL_LIEN);
    f.destroy();
    expect(req.cancelled).toBe(true);
  });
});
