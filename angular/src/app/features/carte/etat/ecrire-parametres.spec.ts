import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ecrireParametres } from './ecrire-parametres';

@Component({ selector: 'mg-page', template: '' }) class Page {}

async function ouvrir(url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'carte', component: Page, children: [{ path: 'risques', component: Page }] }, { path: 'ailleurs', component: Page }])],
  });
  const harness = await RouterTestingHarness.create(url);
  const router = TestBed.inject(Router);
  // La route de la page : celle que les écrivains de la carte passent en `relativeTo`.
  const route = router.routerState.root.firstChild as ActivatedRoute;
  const stable = async () => { await new Promise((r) => setTimeout(r, 0)); await harness.fixture.whenStable(); };
  return { router, route, stable };
}

describe('ecrireParametres (piège P-g)', () => {
  it('deux écritures du même tick : les deux restent', async () => {
    const { router, route, stable } = await ouvrir('/carte?garde=1');
    void ecrireParametres(router, route, { a: '1' });
    void ecrireParametres(router, route, { b: '2' });
    await stable();
    expect(router.url).toBe('/carte?garde=1&a=1&b=2');
  });
  it('dans l’autre ordre, et un nul retire la clé', async () => {
    const { router, route, stable } = await ouvrir('/carte?garde=1');
    void ecrireParametres(router, route, { b: '2' });
    void ecrireParametres(router, route, { a: '1', garde: null });
    await stable();
    expect(router.url).toBe('/carte?b=2&a=1');
  });
  it('une navigation en vol vers un AUTRE chemin : l’écriture la suit, jamais l’ancien chemin', async () => {
    const { router, route, stable } = await ouvrir('/carte?garde=1');
    void router.navigateByUrl('/ailleurs?x=1');
    void ecrireParametres(router, route, { a: '1' });
    await stable();
    expect(router.url).toBe('/ailleurs?x=1&a=1');
  });
  it('avec un chemin : ouvre le module en gardant les paramètres, et c’est une page de l’historique', async () => {
    const { router, route, stable } = await ouvrir('/carte?etape=analyse');
    const nav = vi.spyOn(router, 'navigate');
    void ecrireParametres(router, route, { risque: 'jeu' }, ['risques']);
    await stable();
    expect(router.url).toBe('/carte/risques?etape=analyse&risque=jeu');
    expect(nav.mock.calls[0][1]?.replaceUrl).toBe(false);
  });
});
