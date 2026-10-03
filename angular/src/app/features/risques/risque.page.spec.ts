import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { RisquePage } from './risque.page';

@Component({ selector: 'mg-vide', template: '' })
class Vide {}

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** L'écran sous un vrai routeur de test, avec une carte factice qui compte ses créations. */
async function ouvrir(url = '/risques') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  const cartes: CarteFactice[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'risques', component: RisquePage },
        { path: '', component: Vide },
      ]),
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { const c = new CarteFactice(o); cartes.push(c); return c; } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const page = await harness.navigateByUrl(url, RisquePage);
  await stabiliser(harness);
  return { harness, page, cartes, router: TestBed.inject(Router), el: () => harness.routeNativeElement as HTMLElement };
}

async function stabiliser(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    await attendre();
    await harness.fixture.whenStable();
  }
}

function etape(el: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...el.querySelectorAll<HTMLButtonElement>('nav[aria-label="Étapes du parcours"] button')]
    .find((x) => x.textContent?.includes(libelle));
  if (!b) throw new Error(`étape introuvable : ${libelle}`);
  return b;
}

describe('RisquePage', () => {
  it("(f) l'en-tête porte le titre, le fil d'Ariane du territoire et cinq étapes", async () => {
    const { el } = await ouvrir();
    expect(el().querySelector('h2')?.textContent?.trim()).toBe('Population à risque industriel');
    expect(el().querySelector('nav[aria-label="Fil d’Ariane"]')?.textContent).toContain('France entière');
    const etapes = [...el().querySelectorAll('nav[aria-label="Étapes du parcours"] button')];
    expect(etapes.map((b) => b.textContent?.replace(/\s+/g, ' ').trim().replace(/ \(renseignée\)$/, ''))).toEqual([
      '1 Sites', '2 Rayon', '3 Couverture', '4 Zones', '5 Campagne',
    ]);
    expect(etape(el(), 'Sites').getAttribute('aria-current')).toBe('step');
    expect(el().querySelector('[data-panneau]')?.getAttribute('data-panneau')).toBe('sites');
  });

  it("(g) cliquer l'étape ③ réécrit `?risque=` SANS recréer l'écran", async () => {
    const { harness, page, router, el } = await ouvrir();
    etape(el(), 'Couverture').click();
    await stabiliser(harness);
    expect(router.url).toBe('/risques?risque=etape%3Dcouverture');
    expect(harness.routeDebugElement?.componentInstance).toBe(page);
    expect(el().querySelector('[data-panneau]')?.getAttribute('data-panneau')).toBe('couverture');
    expect(etape(el(), 'Couverture').getAttribute('aria-current')).toBe('step');
  });

  it("(h) « Carte seule » replie l'aside en visibility: hidden, largeur nulle ; le panneau reste dans le DOM", async () => {
    const { harness, el } = await ouvrir();
    const aside = el().querySelector('aside')!;
    expect(aside.style.width).toBe('480px');
    const bouton = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Carte seule'))!;
    bouton.click();
    await stabiliser(harness);
    expect(aside.style.visibility).toBe('hidden');
    expect(aside.style.width).toBe('0px');
    expect(el().querySelector('aside [data-panneau="sites"]')).not.toBeNull();
    expect(el().querySelector('[role="separator"]')).toBeNull();
    // Et retour : le même aside, jamais recréé.
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Afficher le panneau'))!.click();
    await stabiliser(harness);
    expect(el().querySelector('aside')).toBe(aside);
    expect(aside.style.visibility).toBe('visible');
  });

  it('(i) Échap sur l’hôte navigue vers le parent RELATIF', async () => {
    const { harness, router, el } = await ouvrir('/risques?risque=etape%3Drayon');
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await stabiliser(harness);
    expect(router.url).toBe('/');
  });

  it("(i bis) la croix « Fermer » navigue aussi vers le parent", async () => {
    const { harness, router, el } = await ouvrir();
    el().querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!.click();
    await stabiliser(harness);
    expect(router.url).toBe('/');
  });

  it('(j) la carte MapLibre est créée UNE fois, même après trois changements d’étape', async () => {
    const { harness, cartes, page, el } = await ouvrir();
    expect(cartes).toHaveLength(1);
    for (const l of ['Rayon', 'Couverture', 'Zones', 'Sites']) {
      etape(el(), l).click();
      await stabiliser(harness);
    }
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
    expect(harness.routeDebugElement?.componentInstance).toBe(page);
  });

  it('une URL malformée ouvre un état partiellement récupéré, jamais un écran blanc', async () => {
    const { el, router } = await ouvrir('/risques?risque=profil%3Dillisible%26onglet%3Dterritoires%26jeu%3Dx%26fusion%3Doui');
    expect(el().querySelector('h2')).not.toBeNull();
    expect(el().querySelector('[data-panneau]')?.getAttribute('data-panneau')).toBe('couverture');
    // L'alias est réécrit sous sa forme courante ; profil, jeu et fusion retombent au défaut, donc ne s'écrivent pas.
    expect(router.url).toBe('/risques?risque=etape%3Dcouverture');
  });

  it("la poignée suit le pointeur par capture sur ELLE-MÊME, bornée 320-900 px", async () => {
    const { harness, el } = await ouvrir();
    const poignee = el().querySelector<HTMLElement>('[role="separator"]')!;
    poignee.setPointerCapture = vi.fn();
    const evenement = (type: string, x: number) => {
      const e = new MouseEvent(type, { clientX: x, bubbles: true }) as MouseEvent & { pointerId: number };
      Object.defineProperty(e, 'pointerId', { value: 1 });
      return e;
    };
    poignee.dispatchEvent(evenement('pointerdown', 500));
    expect(poignee.setPointerCapture).toHaveBeenCalledWith(1);
    poignee.dispatchEvent(evenement('pointermove', 2000));
    await stabiliser(harness);
    expect(el().querySelector('aside')!.style.width).toBe('900px');
    poignee.dispatchEvent(evenement('pointermove', 0));
    await stabiliser(harness);
    expect(el().querySelector('aside')!.style.width).toBe('320px');
    poignee.dispatchEvent(evenement('pointerup', 0));
    poignee.dispatchEvent(evenement('pointermove', 700));
    await stabiliser(harness);
    expect(el().querySelector('aside')!.style.width).toBe('320px');
  });

  it("l'interrupteur « Codes postaux » est désactivé sans jeu ; avec un jeu, ④ dédouble la vue et masque « Carte seule »", async () => {
    const { el } = await ouvrir('/risques?risque=etape%3Dzones%26jeu%3D0b7ece33-4903-4a0b-a57a-f6c54e78a729');
    expect(el().querySelector('[data-vue="rayons"]')).not.toBeNull();
    expect((el().querySelector('[data-vue="codes-postaux"]') as HTMLElement).style.visibility).toBe('visible');
    const seule = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Carte seule'))!;
    expect(seule.classList.contains('hidden')).toBe(true);
  });

  it("sans jeu, à l'étape ②, « Codes postaux » est désactivé et la carte des codes postaux n'est pas visible", async () => {
    const { el } = await ouvrir('/risques?risque=etape%3Drayon');
    const cp = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Codes postaux'))!;
    expect(cp.disabled).toBe(true);
    expect((el().querySelector('[data-vue="codes-postaux"]') as HTMLElement).style.visibility).toBe('hidden');
    expect((el().querySelector('[data-vue="rayons"]') as HTMLElement).style.visibility).toBe('visible');
  });
});
