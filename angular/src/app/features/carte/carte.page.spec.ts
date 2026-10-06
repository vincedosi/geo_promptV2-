import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { AuthService } from '../../core/auth/auth.service';
import { OrganisationsApi } from '../session/data/organisations.api';
import { CartePage } from './carte.page';
import { ENTREES_NAVIGATION } from './logique/navigation';

@Component({ selector: 'mg-vide', template: '' })
class Vide {}

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

async function ouvrir() {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  const cartes: CarteFactice[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'carte', component: CartePage }, { path: '', component: Vide }]),
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { const c = new CarteFactice(o); cartes.push(c); return c; } },
      {
        provide: AuthService,
        useValue: {
          session: signal({ access_token: 'j', user: { email: 'a@exemple.test', user_metadata: {} } }),
          connecte: computed(() => true), email: computed(() => 'a@exemple.test'),
          lireRole: async () => null, deconnecter: async () => undefined,
        },
      },
      { provide: OrganisationsApi, useValue: { lister: () => of({ organizations: [], active_org_id: null, is_super_admin: false }), changer: () => of() } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/carte');
  const stable = async () => {
    for (let i = 0; i < 3; i++) { await attendre(); await harness.fixture.whenStable(); }
  };
  await stable();
  const hote = harness.fixture.nativeElement.querySelector('mg-carte-principale') as HTMLElement;
  return { harness, hote, cartes, stable };
}

/** Une frappe sur l'hôte, dont la cible COMPOSÉE est `cible` (par défaut l'hôte lui-même). */
function frapper(hote: HTMLElement, init: KeyboardEventInit, cible: Element = hote): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init });
  cible.dispatchEvent(e);
  return e;
}

const titrePanneau = (hote: HTMLElement) => hote.querySelector('mg-panneau-carte')?.getAttribute('aria-label') ?? null;

describe('CartePage — squelette de la carte principale', () => {
  it("(f) le rail rend les entrées de ENTREES_NAVIGATION dans l'ordre, SANS l'Assistant : 5 en haut, 2 en bas", async () => {
    const { hote } = await ouvrir();
    const rail = hote.querySelector('mg-rail')!;
    const ids = [...rail.querySelectorAll('button[data-entree]')].map((b) => b.getAttribute('data-entree'));
    expect(ids).toEqual(ENTREES_NAVIGATION.filter((e) => e.id !== 'assistant').map((e) => e.id));
    expect(rail.querySelectorAll('[data-bas] button[data-entree]').length).toBe(2);
    expect(ids.length - 2).toBe(5);
    // Libellés et infobulles de la source unique.
    const filtre = rail.querySelector('button[data-entree="filtre"]')!;
    expect(filtre.textContent?.trim()).toBe('Filtre');
    expect(filtre.getAttribute('title')).toBe('Où je regarde');
    // Un seul séparateur : celui qui suit Campagne (celui de l'Assistant part avec lui).
    expect(rail.querySelectorAll('[data-separateur]').length).toBe(1);
  });

  it('(g) Alt+2 sur l\'hôte ouvre « Calques », Échap le ferme (après la sortie de 200 ms)', async () => {
    const { hote, stable } = await ouvrir();
    const e = frapper(hote, { key: '2', altKey: true });
    await stable();
    expect(e.defaultPrevented).toBe(true);
    expect(titrePanneau(hote)).toBe('Calques');
    frapper(hote, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it("(h) Alt+2 dont la cible composée est un <input> : rien", async () => {
    const { hote, stable } = await ouvrir();
    const champ = document.createElement('input');
    hote.appendChild(champ);
    frapper(hote, { key: '2', altKey: true }, champ);
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('(i) Échap depuis un <input> ferme quand même', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '1', altKey: true });
    await stable();
    expect(titrePanneau(hote)).toBe('Filtre');
    const champ = document.createElement('input');
    hote.appendChild(champ);
    frapper(hote, { key: 'Escape' }, champ);
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('(j) Campagne est inerte : clic et Alt+C n\'ouvrent rien ; Ctrl+K (Assistant) n\'est pas capté', async () => {
    const { hote, stable } = await ouvrir();
    const campagne = hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="campagne"]')!;
    expect(campagne.getAttribute('aria-disabled')).toBe('true');
    expect(campagne.getAttribute('title')).toBe('Disponible prochainement');
    campagne.click();
    frapper(hote, { key: 'c', altKey: true });
    const k = frapper(hote, { key: 'k', ctrlKey: true });
    await stable();
    expect(titrePanneau(hote)).toBeNull();
    expect(hote.querySelector('mg-rail [aria-pressed="true"]')).toBeNull();
    expect(k.defaultPrevented).toBe(false);
  });

  it('un clic sur une entrée ouvre son panneau (titre, point de couleur), re-cliquer le ferme ; un autre outil garde le MÊME panneau', async () => {
    const { hote, stable } = await ouvrir();
    const bouton = (id: string) => hote.querySelector<HTMLButtonElement>(`mg-rail button[data-entree="${id}"]`)!;
    bouton('analyse').click();
    await stable();
    const panneau = hote.querySelector('mg-panneau-carte')!;
    expect(titrePanneau(hote)).toBe('Analyse');
    expect(panneau.querySelector<HTMLElement>('[data-pastille]')!.style.background).toBe('var(--cat-analysis)');
    expect(bouton('analyse').getAttribute('aria-pressed')).toBe('true');
    bouton('zones').click();
    await stable();
    expect(hote.querySelector('mg-panneau-carte')).toBe(panneau);
    expect(titrePanneau(hote)).toBe('Zones');
    bouton('zones').click();
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('un clic HORS du panneau et du rail le ferme ; dans le panneau, non', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '3', altKey: true });
    await stable();
    hote.querySelector('mg-panneau-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBe('Analyse');
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('(k) mode immersif : rail en translateX(-100%), barre du haut masquée ; Échap ré-affiche', async () => {
    const { hote, stable } = await ouvrir();
    const bouton = hote.querySelector<HTMLButtonElement>('button[data-immersif]')!;
    expect(bouton.getAttribute('title')).toBe('Masquer la barre (mode immersif)');
    bouton.click();
    await stable();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(-100%)');
    expect(hote.querySelector('mg-barre-haut')).toBeNull();
    expect(bouton.getAttribute('aria-pressed')).toBe('true');
    expect(bouton.getAttribute('title')).toBe('Afficher la barre (Escape)');
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(0)');
    expect(hote.querySelector('mg-barre-haut')).not.toBeNull();
  });

  it('Échap ferme le DERNIER ouvert : panneau ouvert après le mode immersif → panneau d\'abord', async () => {
    const { hote, stable } = await ouvrir();
    hote.querySelector<HTMLButtonElement>('button[data-immersif]')!.click();
    await stable();
    frapper(hote, { key: '1', altKey: true });
    await stable();
    frapper(hote, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(-100%)');
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(0)');
  });

  it('(l) la carte est créée UNE fois, au centre et au zoom de React, fond Liberty, zoom en bas à droite avec boussole', async () => {
    const { cartes } = await ouvrir();
    expect(cartes).toHaveLength(1);
    const o = cartes[0].options as Record<string, unknown>;
    expect(o['center']).toEqual([2.3, 46.6]);
    expect(o['zoom']).toBe(5.5);
    expect(o['style']).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(cartes[0].controles[0].position).toBe('bottom-right');
  });

  it('badge de zoom : « z5  20km » au départ, puis suit le zoom (paliers de get_tile)', async () => {
    const { hote, cartes, stable } = await ouvrir();
    const badge = () => hote.querySelector('[data-badge-zoom]')!.textContent;
    expect(badge()).toBe('z5  20km');
    for (const [z, attendu] of [[12.4, 'z12  200m'], [9, 'z9  1km'], [8.9, 'z8  2km'], [7, 'z7  5km'], [3.5, 'z3  —']] as const) {
      cartes[0].zoom = z;
      cartes[0].emettre('zoom');
      await stable();
      expect(badge()).toBe(attendu);
    }
  });

  it('la barre du haut porte le logo, la bascule Campagne (inerte) / Carte (pressée), le thème et la session', async () => {
    const { hote } = await ouvrir();
    const barre = hote.querySelector('mg-barre-haut')!;
    expect(barre.querySelector('mg-logo')).not.toBeNull();
    expect(barre.querySelector('[data-bascule="campagne"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(barre.querySelector('[data-bascule="carte"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(barre.querySelector('mg-bascule-theme')).not.toBeNull();
    expect(barre.querySelector('mg-badge-session')).not.toBeNull();
  });

  it("une navigation de requête RÉUTILISE l'écran : ni page ni carte recréées", async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    await TestBed.inject(Router).navigateByUrl('/carte?risque=etape%3Drayon');
    await stable();
    expect(harness.fixture.nativeElement.querySelector('mg-carte-principale')).toBe(hote);
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
  });
});
