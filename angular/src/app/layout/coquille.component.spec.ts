import { TestBed } from '@angular/core/testing';
import { Component, computed, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { MODE_DEVELOPPEMENT } from '../core/environnement/mode-developpement';
import { OrganisationsApi } from '../features/session/data/organisations.api';
import { BadgeSessionComponent } from './badge-session.component';
import { CoquilleComponent } from './coquille.component';

let creations = 0;

@Component({ selector: 'mg-page-factice', template: '<p>page</p>' })
class PageFactice {
  constructor() {
    creations++;
  }
}

async function monter() {
  creations = 0;
  const session = signal<unknown>({ access_token: 'j', user: { email: 'a@exemple.test', user_metadata: {} } });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: '',
          component: CoquilleComponent,
          children: [
            { path: '', component: PageFactice },
            { path: 'catalogue', component: PageFactice },
          ],
        },
      ]),
      { provide: MODE_DEVELOPPEMENT, useValue: true },
      {
        provide: AuthService,
        useValue: { session, connecte: computed(() => true), email: computed(() => 'a@exemple.test'), lireRole: async () => null, deconnecter: async () => undefined },
      },
      {
        provide: OrganisationsApi,
        useValue: {
          lister: () => of({ organizations: [{ id: 'o1', name: 'dentsu', slug: 'd', logo_url: null }], active_org_id: 'o1', is_super_admin: true }),
          changer: () => of({ success: true, organization_id: 'o1' }),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/');
  document.body.appendChild(harness.fixture.nativeElement);
  const el = harness.fixture.nativeElement as HTMLElement;
  const stable = async () => {
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await harness.fixture.whenStable();
    }
  };
  await stable();
  return { harness, el, stable };
}

const declencheur = (el: HTMLElement) =>
  [...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Ouvrir la navigation') as HTMLButtonElement;
const tiroir = (el: HTMLElement) => el.querySelector('[data-tiroir]');

describe('CoquilleComponent — AppSidebar + TopRightChrome + MainPadding', () => {
  afterEach(() => document.body.replaceChildren());

  it('grand écran : barre de 240 px, bord droit 0,5 px, masquée sous 768 px (hidden md:flex)', async () => {
    const { el } = await monter();
    const aside = el.querySelector('aside')!;
    expect(aside.className).toContain('w-60');
    expect(aside.className).toContain('border-r-fin');
    expect(aside.className).toContain('hidden');
    expect(aside.className).toContain('md:flex');
    expect(aside.querySelector('mg-barre-laterale')).not.toBeNull();
  });

  it('contenu : marge intérieure p-8 (MainPadding.tsx)', async () => {
    const { el } = await monter();
    const page = el.querySelector('mg-page-factice')!;
    expect(page.parentElement!.className).toContain('p-8');
  });

  it('chrome haut-droite : rangée `sticky` de hauteur nulle dans le défilement, jamais `fixed`', async () => {
    const { el } = await monter();
    const chrome = el.querySelector('main .overflow-auto > .sticky > mg-chrome-haut')!;
    expect(chrome).not.toBeNull();
    const rangee = chrome.parentElement!;
    expect(rangee.className).toContain('sticky');
    expect(rangee.className).toContain('h-0');
    expect(rangee.className).not.toMatch(/(^|\s)fixed(\s|$)/);
  });

  it('petit écran : le bouton Menu (md:hidden) ouvre le tiroir, et le focus y entre', async () => {
    const { el, stable } = await monter();
    const bouton = declencheur(el);
    expect(bouton.className).toContain('md:hidden');
    expect(bouton.className).toContain('absolute');
    expect(tiroir(el)).toBeNull();
    bouton.click();
    await stable();
    const t = tiroir(el)!;
    expect(t.getAttribute('role')).toBe('dialog');
    expect(t.getAttribute('aria-modal')).toBe('true');
    expect(t.querySelector('mg-barre-laterale')).not.toBeNull();
    expect(t.contains(document.activeElement)).toBe(true);
    expect(bouton.getAttribute('aria-expanded')).toBe('true');
  });

  it('Échap ferme le tiroir et rend le focus au bouton Menu', async () => {
    const { el, stable } = await monter();
    declencheur(el).click();
    await stable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await stable();
    expect(tiroir(el)).toBeNull();
    expect(document.activeElement).toBe(declencheur(el));
  });

  it('un clic sur le voile (hors du tiroir) le ferme et rend le focus', async () => {
    const { el, stable } = await monter();
    declencheur(el).click();
    await stable();
    (el.querySelector('[data-voile]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await stable();
    expect(tiroir(el)).toBeNull();
    expect(document.activeElement).toBe(declencheur(el));
  });

  it('le bouton Fermer du tiroir le ferme', async () => {
    const { el, stable } = await monter();
    declencheur(el).click();
    await stable();
    const fermer = [...tiroir(el)!.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Fermer') as HTMLButtonElement;
    fermer.click();
    await stable();
    expect(tiroir(el)).toBeNull();
  });

  it('Tab reste dans le tiroir (piège de focus, comme la Sheet Radix)', async () => {
    const { el, stable } = await monter();
    declencheur(el).click();
    await stable();
    const t = tiroir(el)!;
    const focusables = [...t.querySelectorAll<HTMLElement>('a[href], button, [tabindex="0"]')];
    focusables.at(-1)!.focus();
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await stable();
    expect(document.activeElement).toBe(focusables[0]);
  });

  it('suivre un lien du tiroir le ferme', async () => {
    const { el, stable, harness } = await monter();
    declencheur(el).click();
    await stable();
    const lien = [...tiroir(el)!.querySelectorAll('a[href]')].find((a) => a.getAttribute('aria-label') === 'Catalogue') as HTMLAnchorElement;
    lien.click();
    await stable();
    expect(TestBed.inject(Router).url).toBe('/catalogue');
    expect(tiroir(el)).toBeNull();
    expect(harness).toBeTruthy();
  });

  it('changer d\'organisation recrée la page courante (équivalent du `window.location.reload()` de React, sans quitter la remote)', async () => {
    const { harness, stable } = await monter();
    const avant = creations;
    const url = TestBed.inject(Router).url;
    const badge = harness.fixture.debugElement.query(By.directive(BadgeSessionComponent)).componentInstance as BadgeSessionComponent;
    badge.orgChangee.emit('o1');
    await stable();
    expect(creations).toBe(avant + 1);
    expect(TestBed.inject(Router).url).toBe(url);
  });
});
