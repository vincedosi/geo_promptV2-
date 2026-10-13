import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ParcoursService } from './parcours.service';

@Component({ selector: 'mg-hote-parcours', template: '<router-outlet />', providers: [ParcoursService],
  imports: [RouterOutlet] })
class Hote { readonly parcours = inject(ParcoursService); }
@Component({ selector: 'mg-module', template: '' }) class Module {}

const attendre = () => new Promise((r) => setTimeout(r, 0));

async function ouvrir(url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'carte', component: Hote, children: [{ path: 'risques', component: Module }] }])],
  });
  const harness = await RouterTestingHarness.create();
  const hote = await harness.navigateByUrl(url, Hote);
  await attendre(); await harness.fixture.whenStable();
  const router = TestBed.inject(Router);
  return { harness, hote, router, stable: async () => { await attendre(); await harness.fixture.whenStable(); } };
}

describe('ParcoursService — l’étape dans l’URL', () => {
  it('/carte : ① sans paramètre ; choisir ② écrit ?etape=donnees, en remplaçant l’entrée d’historique', async () => {
    const { hote, router, stable } = await ouvrir('/carte');
    expect(hote.parcours.etape()).toBe('perimetre');
    expect(router.url).toBe('/carte');
    const nav = vi.spyOn(router, 'navigate');
    hote.parcours.choisir('donnees');
    await stable();
    expect(router.url).toBe('/carte?etape=donnees');
    expect(nav.mock.calls[0][1]).toMatchObject({ replaceUrl: true, queryParamsHandling: 'merge' });
  });
  it('revenir à ① retire le paramètre (le défaut ne s’écrit pas)', async () => {
    const { hote, router, stable } = await ouvrir('/carte?etape=zones');
    hote.parcours.choisir('perimetre');
    await stable();
    expect(router.url).toBe('/carte');
  });
  it('?etape=inconnue : ① et URL nettoyée une fois (Review Focus 1)', async () => {
    const { hote, router } = await ouvrir('/carte?etape=inconnue');
    expect(hote.parcours.etape()).toBe('perimetre');
    expect(router.url).toBe('/carte');
  });
  it('?customZone=z sans etape : ④, etape=zones écrit, customZone gardé', async () => {
    const { hote, router } = await ouvrir('/carte?customZone=z');
    expect(hote.parcours.etape()).toBe('zones');
    expect(router.url).toContain('customZone=z');
    expect(router.url).toContain('etape=zones');
  });
  it('une navigation EXTÉRIEURE (retour, lien collé) change l’étape sans recréer le service', async () => {
    const { hote, router, stable } = await ouvrir('/carte');
    await router.navigateByUrl('/carte?etape=analyse');
    await stable();
    expect(hote.parcours.etape()).toBe('analyse');
  });
  it('les étapes visitées s’accumulent (leurs panneaux restent montés)', async () => {
    const { hote, stable } = await ouvrir('/carte');
    hote.parcours.choisir('zones'); await stable();
    hote.parcours.choisir('donnees'); await stable();
    hote.parcours.choisir('zones'); await stable();
    expect([...hote.parcours.visitees()].sort()).toEqual(['donnees', 'perimetre', 'zones']);
  });
  it('module enfant ouvert : écrire l’étape garde /carte/risques et ?risque= (Review Focus 2)', async () => {
    const { hote, router, stable } = await ouvrir('/carte/risques?risque=etape%3Drayon');
    hote.parcours.choisir('zones');
    await stable();
    expect(router.url.startsWith('/carte/risques?')).toBe(true);
    expect(router.url).toContain('risque=etape%3Drayon');
    expect(router.url).toContain('etape=zones');
  });
});
