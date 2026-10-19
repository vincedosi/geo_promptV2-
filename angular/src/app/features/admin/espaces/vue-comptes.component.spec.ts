import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import type { CompteResume, EspaceResume } from './logique/types';
import { VueComptesComponent } from './vue-comptes.component';
import { texte } from '../testing/dom';

const URL = '/api/admin/espaces/comptes';

function espace(id: string, nom: string): EspaceResume {
  return { id, nom, nom_affiche: nom, slug: id, actif: true, interne: false, nb_membres: 1, nb_jeux_prives: 0 };
}
const ESPACES = [espace('org-b', 'BMW GROUP'), espace('org-m', 'MARINE')];
const MARINE = { id: 'org-m', nom_affiche: 'MARINE' };
const BMW = { id: 'org-b', nom_affiche: 'BMW GROUP' };

function compte(p: Partial<CompteResume> & { id: string; email: string }): CompteResume {
  return { nom: null, role: 'client', espace_actif: null, espaces: [], cree_le: '2026-10-01T10:00:00Z', ...p };
}
const COMPTES: CompteResume[] = [
  compte({ id: 'sa', email: 'admin@dentsu.test', nom: 'Admin', role: 'super_admin', cree_le: '2026-03-15T08:00:00Z' }),
  compte({ id: 'c1', email: 'marin@marine.test', nom: 'Hélène Marin', espace_actif: 'org-m', espaces: [BMW, MARINE] }),
  compte({ id: 'c2', email: 'pilote@bmw.test', espace_actif: 'org-b', espaces: [BMW] }),
  compte({ id: 'c3', email: 'orphelin@exemple.test', cree_le: null }),
];

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
  const recharger = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger } },
      { provide: AuthService, useValue: { session: signal({ user: { id: 'moi' } }) } },
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(VueComptesComponent);
  const http = TestBed.inject(HttpTestingController);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  const charger = async (comptes: CompteResume[] = COMPTES) => {
    http.expectOne(URL).flush({ comptes });
    await stable();
  };
  const filtrer = async (v: string) => {
    const champ = el.querySelector<HTMLInputElement>('input[data-filtre]')!;
    champ.value = v;
    champ.dispatchEvent(new Event('input'));
    await stable();
  };
  const ligne = (id: string) => el.querySelector<HTMLTableRowElement>(`tr[data-compte="${id}"]`)!;
  return { f, el, http, stable, charger, filtrer, ligne, recharger };
}

/** « libellé effectif » d'un bandeau de groupe. */
const bandeau = (g: Element | null) => `${texte(g?.querySelector('[data-libelle]'))} ${texte(g?.querySelector('[data-effectif]'))}`;

describe('VueComptesComponent — « Tous les comptes »', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('montage → UN GET admin/espaces/comptes ; squelettes pendant la lecture', async () => {
    const { el, http, charger } = await monter();
    expect(el.querySelectorAll('[data-squelette]').length).toBeGreaterThan(0);
    await charger();
    expect(el.querySelectorAll('[data-squelette]')).toHaveLength(0);
    http.expectNone(URL);
  });

  it('regroupe comme React : Super admins, puis un groupe par espace actif (alphabétique), puis « Sans espace » ; effectif dans le bandeau', async () => {
    const { el, charger } = await monter();
    await charger();
    const bandeaux = [...el.querySelectorAll('[data-groupe]')].map(bandeau);
    expect(bandeaux).toEqual(['Super admins 1', 'BMW GROUP 1', 'MARINE 1', 'Sans espace 1']);
    expect(el.querySelector('[data-groupe] .point')).not.toBeNull();
  });

  it('colonnes : Nom · Email · Rôle (libellé, badge) · Espaces (tous, l\'actif marqué) · Créé le (fr-FR)', async () => {
    const { el, charger, ligne } = await monter();
    await charger();
    expect([...el.querySelectorAll('thead th')].map((t) => texte(t))).toEqual(['Nom', 'Email', 'Rôle', 'Espaces', 'Créé le']);
    const marin = ligne('c1');
    const cellules = [...marin.querySelectorAll('td')];
    expect(texte(cellules[0])).toBe('Hélène Marin');
    expect(texte(cellules[1])).toBe('marin@marine.test');
    expect(cellules[1].classList.contains('email')).toBe(true);
    expect(texte(cellules[2].querySelector('.badge'))).toBe('Client');
    const pastilles = [...cellules[3].querySelectorAll('.pastille')];
    expect(pastilles.map((p) => texte(p))).toEqual(['BMW GROUP', 'MARINE']);
    expect(pastilles.map((p) => p.classList.contains('actif'))).toEqual([false, true]);
    expect(pastilles[1].getAttribute('title')).toBe('Espace actif');
    expect(texte(cellules[4])).toBe('01/10/2026');
    expect(texte(ligne('sa').querySelectorAll('td')[2].querySelector('.badge'))).toBe('Super admin');
    // Sans nom → tiret ; sans espace → tiret ; date absente → tiret.
    const orphelin = [...ligne('c3').querySelectorAll('td')];
    expect(texte(orphelin[0])).toBe('—');
    expect(texte(orphelin[3])).toBe('—');
    expect(texte(orphelin[4])).toBe('—');
  });

  it('filtre LOCAL par nom ou email, insensible à la casse et aux accents ; aucun appel', async () => {
    const { el, http, charger, filtrer } = await monter();
    await charger();
    await filtrer('HELENE');
    expect([...el.querySelectorAll('tr[data-compte]')].map((t) => t.getAttribute('data-compte'))).toEqual(['c1']);
    expect([...el.querySelectorAll('[data-groupe]')].map(bandeau)).toEqual(['MARINE 1']);
    await filtrer('bmw.TEST');
    expect([...el.querySelectorAll('tr[data-compte]')].map((t) => t.getAttribute('data-compte'))).toEqual(['c2']);
    await filtrer('introuvable');
    expect(el.querySelectorAll('tr[data-compte]')).toHaveLength(0);
    expect(texte(el.querySelector('[data-aucun]'))).toBe('Aucun compte ne correspond à « introuvable ».');
    http.expectNone(URL);
  });

  it('clic sur un compte SANS espace → la fiche utilisateur s\'ouvre, aucune case cochée', async () => {
    const { el, charger, ligne, stable } = await monter();
    await charger();
    ligne('c3').click();
    await stable();
    expect(el.querySelector('mg-fiche-utilisateur dialog[open]')).not.toBeNull();
    expect(texte(el.querySelector('mg-fiche-utilisateur h2'))).toBe('orphelin@exemple.test');
    const cases = [...el.querySelectorAll<HTMLInputElement>('mg-fiche-utilisateur input[type="checkbox"]')];
    expect(cases).toHaveLength(2);
    expect(cases.every((c) => !c.checked)).toBe(true);
  });

  it('le nom est un VRAI bouton (Entrée et Espace natifs, rôle accessible) → la fiche, cochée de TOUS les espaces du compte', async () => {
    const { el, charger, ligne, stable } = await monter();
    await charger();
    // La ligne n'est plus un faux bouton focalisable : le focus clavier va au bouton du nom.
    expect(ligne('c1').hasAttribute('tabindex')).toBe(false);
    const bouton = ligne('c1').querySelector<HTMLButtonElement>('button[data-ouvrir]')!;
    expect(bouton.type).toBe('button');
    expect(bouton.getAttribute('aria-label')).toBe('Hélène Marin, ouvrir la fiche (marin@marine.test)');
    // Entrée ou Espace sur un <button> déclenchent un clic natif, qui remonte à la ligne.
    bouton.click();
    await stable();
    expect(el.querySelectorAll('mg-fiche-utilisateur')).toHaveLength(1);
    const coches = [...el.querySelectorAll<HTMLInputElement>('mg-fiche-utilisateur input[type="checkbox"]:checked')];
    expect(coches.map((c) => c.getAttribute('data-espace'))).toEqual(['org-b', 'org-m']);
    expect(el.querySelector<HTMLSelectElement>('mg-fiche-utilisateur select[data-actif]')!.selectedOptions[0].value).toBe('org-m');
  });

  it('fiche fermée APRÈS une écriture → la liste est relue, et les compteurs de la colonne aussi', async () => {
    const { el, http, charger, ligne, stable, recharger } = await monter();
    await charger();
    ligne('c3').click();
    await stable();
    const c = el.querySelector<HTMLInputElement>('mg-fiche-utilisateur input[data-espace="org-b"]')!;
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    await stable();
    el.querySelector<HTMLButtonElement>('mg-fiche-utilisateur [data-enregistrer-espaces]')!.click();
    await stable();
    http.expectOne('/api/admin/users/c3/espaces').flush({ espaces: ['org-b'], espace_actif: 'org-b' });
    await stable();
    el.querySelector<HTMLButtonElement>('mg-fiche-utilisateur [data-fermer]')!.click();
    await stable();
    expect(el.querySelector('mg-fiche-utilisateur')).toBeNull();
    await charger(COMPTES.map((x) => (x.id === 'c3' ? { ...x, espace_actif: 'org-b', espaces: [BMW] } : x)));
    expect(recharger).toHaveBeenCalledTimes(1);
    expect([...el.querySelectorAll('[data-groupe]')].map(bandeau)).toEqual(['Super admins 1', 'BMW GROUP 2', 'MARINE 1']);
  });

  it('fiche fermée SANS écriture → rien n\'est relu', async () => {
    const { el, http, charger, ligne, stable, recharger } = await monter();
    await charger();
    ligne('c2').click();
    await stable();
    el.querySelector<HTMLButtonElement>('mg-fiche-utilisateur [data-fermer]')!.click();
    await stable();
    http.expectNone(URL);
    expect(recharger).not.toHaveBeenCalled();
  });

  it('« Créer un compte » (CTA principal) ouvre le dialogue ; création → liste et compteurs relus', async () => {
    const { el, http, charger, stable, recharger } = await monter();
    await charger();
    const bouton = el.querySelector<HTMLButtonElement>('[data-creer-compte]')!;
    expect(texte(bouton)).toBe('Créer un compte');
    expect(bouton.classList.contains('principal')).toBe(true);
    bouton.click();
    await stable();
    expect(el.querySelector('mg-dialogue-creation-compte dialog[open]')).not.toBeNull();
    const email = el.querySelector<HTMLInputElement>('mg-dialogue-creation-compte [data-email]')!;
    email.value = 'chef@exemple.fr';
    email.dispatchEvent(new Event('input'));
    const sa = el.querySelector<HTMLInputElement>('mg-dialogue-creation-compte input[type="radio"][value="super_admin"]')!;
    sa.checked = true;
    sa.dispatchEvent(new Event('change'));
    await stable();
    el.querySelector('mg-dialogue-creation-compte form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await stable();
    http.expectOne('/api/admin/users').flush({ id: 'n', email: 'chef@exemple.fr', setup_link: 'https://exemple.test/lien' }, { status: 201, statusText: 'Created' });
    await stable();
    await charger([...COMPTES, compte({ id: 'n', email: 'chef@exemple.fr', role: 'super_admin' })]);
    expect(recharger).toHaveBeenCalledTimes(1);
    // L'écran « Compte créé » reste affiché pendant la relecture : le lien ne se perd pas.
    expect(el.querySelector<HTMLInputElement>('mg-dialogue-creation-compte input[data-lien-secret]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('mg-dialogue-creation-compte [data-terminer]')!.click();
    await stable();
    expect(el.querySelector('mg-dialogue-creation-compte')).toBeNull();
    expect(bandeau(el.querySelector('[data-groupe]'))).toBe('Super admins 2');
  });

  it('GET en 500 → message + « Réessayer » qui relance la lecture', async () => {
    const { el, http, stable, charger } = await monter();
    http.expectOne(URL).flush({ error: 'Base indisponible' }, { status: 500, statusText: 'Server Error' });
    await stable();
    const alerte = el.querySelector('[role="alert"]')!;
    expect(texte(alerte)).toContain('Base indisponible');
    alerte.querySelector<HTMLButtonElement>('button')!.click();
    await stable();
    await charger();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelectorAll('tr[data-compte]')).toHaveLength(4);
  });

  it('jamais « MAGELIAN » ni « GENESIS » dans le DOM', async () => {
    const { el, charger } = await monter();
    await charger();
    expect(el.textContent).not.toMatch(/MAGELIAN|GENESIS/);
  });
});
