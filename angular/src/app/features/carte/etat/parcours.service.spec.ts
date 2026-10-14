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

async function ouvrir(url: string, espionner = false) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'carte', component: Hote, children: [{ path: 'risques', component: Module }] }])],
  });
  const harness = await RouterTestingHarness.create();
  if (espionner) vi.spyOn(TestBed.inject(Router), 'navigate');
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
    const { hote, router, stable } = await ouvrir('/carte?etape=inconnue', true);
    expect(hote.parcours.etape()).toBe('perimetre');
    expect(router.url).toBe('/carte');
    await stable();
    expect(vi.mocked(router.navigate)).toHaveBeenCalledTimes(1);
  });
  it('?etape= VIDE : réécrit en /carte, en UNE navigation', async () => {
    const { hote, router, stable } = await ouvrir('/carte?etape=', true);
    expect(hote.parcours.etape()).toBe('perimetre');
    await stable();
    expect(router.url).toBe('/carte');
    expect(vi.mocked(router.navigate)).toHaveBeenCalledTimes(1);
  });
  it('lien ?etape=inconnue collé alors que la carte est déjà à ① : nettoyé, en UNE navigation', async () => {
    const { router, stable } = await ouvrir('/carte', true);
    await router.navigateByUrl('/carte?etape=inconnue');
    await stable(); await stable();
    expect(router.url).toBe('/carte');
    expect(vi.mocked(router.navigate)).toHaveBeenCalledTimes(1);
  });
  it('?customZone=z sans etape : ③, etape=zones écrit, customZone gardé', async () => {
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
  it('T11b : ouvrirAutres écrit ?etape=autres, sans étape courante ; choisir une étape referme « Autres » et réécrit l’étape', async () => {
    const { hote, router, stable } = await ouvrir('/carte?etape=zones');
    expect(hote.parcours.autres()).toBe(false);
    expect(hote.parcours.vue()).toBe('zones');
    const nav = vi.spyOn(router, 'navigate');
    hote.parcours.ouvrirAutres();
    await stable();
    expect(router.url).toBe('/carte?etape=autres');
    expect(nav.mock.calls[0][1]).toMatchObject({ replaceUrl: true, queryParamsHandling: 'merge' });
    expect(hote.parcours.autres()).toBe(true);
    expect(hote.parcours.vue()).toBe('autres');
    // L'étape quittée reste celle d'en dessous (rien n'est démonté), « Autres » rejoint les vues montées.
    expect(hote.parcours.etape()).toBe('zones');
    expect([...hote.parcours.visitees()].sort()).toEqual(['autres', 'zones']);
    hote.parcours.ouvrirAutres();
    await stable();
    expect(nav).toHaveBeenCalledTimes(1);
    hote.parcours.choisir('donnees');
    await stable();
    expect(hote.parcours.autres()).toBe(false);
    expect(router.url).toBe('/carte?etape=donnees');
    hote.parcours.ouvrirAutres(); await stable();
    hote.parcours.choisir('perimetre'); await stable();
    expect(router.url).toBe('/carte');
  });
  it('T11b : /carte?etape=autres s’ouvre sur « Autres » sans réécrire l’URL ; une navigation extérieure l’ouvre et le referme', async () => {
    const { hote, router, stable } = await ouvrir('/carte?etape=autres', true);
    expect(hote.parcours.autres()).toBe(true);
    expect(hote.parcours.etape()).toBe('perimetre');
    expect([...hote.parcours.visitees()]).toEqual(['autres']);
    await stable();
    expect(router.url).toBe('/carte?etape=autres');
    expect(vi.mocked(router.navigate)).not.toHaveBeenCalled();
    await router.navigateByUrl('/carte?etape=analyse');
    await stable();
    expect(hote.parcours.autres()).toBe(false);
    expect(hote.parcours.etape()).toBe('analyse');
    await router.navigateByUrl('/carte?etape=autres');
    await stable();
    expect(hote.parcours.autres()).toBe(true);
    expect(hote.parcours.etape()).toBe('analyse');
    // Une valeur voisine illisible (« Autres ») : ① et URL nettoyée, comme toute valeur inconnue.
    await router.navigateByUrl('/carte?etape=Autres');
    await stable(); await stable();
    expect(hote.parcours.autres()).toBe(false);
    expect(hote.parcours.etape()).toBe('perimetre');
    expect(router.url).toBe('/carte');
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
