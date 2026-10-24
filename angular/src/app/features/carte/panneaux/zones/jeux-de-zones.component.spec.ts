import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import { type JeuListe, JeuxApi } from '../../data/jeux.api';
import { JeuxDeZonesComponent } from './jeux-de-zones.component';

const JEU = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';

/** La page qui porte le panneau : la route `carte`, dont le module est l'enfant `risques`. */
@Component({ selector: 'mg-hote-carte', imports: [JeuxDeZonesComponent], template: '<mg-jeux-de-zones />' })
class HoteCarte {}

@Component({ selector: 'mg-module', template: '' })
class Module {}

const jeu = (p: Partial<JeuListe>): JeuListe => ({
  id: JEU, type: 'risque', nom: 'Vallée de la chimie', description: null, version: 2, created_at: '', construit_le: null,
  population_exposee: null, n_cp_retenus: 1234, taux_utile: 75.94, mode_plan: 'pondere', seuil_couverture_cp: 20,
  custom_geo_zone_id: null, zone_nom: null, ...p,
});
const ZONE_JEU = '16fd2706-8baf-433b-82eb-8c7fada847da';

async function monter(lister: () => Observable<unknown>, url = '/carte') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'carte', component: HoteCarte, children: [{ path: 'risques', component: Module }] }]),
      { provide: JeuxApi, useValue: { lister } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  return { harness, el: harness.fixture.nativeElement as HTMLElement, router: TestBed.inject(Router) };
}

describe('JeuxDeZonesComponent', () => {
  it('liste `/api/zones/jeux` : nom, version, type, CP retenus et taux d’utile formatés en fr-FR', async () => {
    const { el } = await monter(() => of({ jeux: [jeu({}), jeu({ id: 'b', nom: 'Fos', version: 1, n_cp_retenus: null, taux_utile: null })] }));
    expect(el.querySelector('h4')?.textContent?.trim()).toBe('Jeux de zones');
    const boutons = [...el.querySelectorAll<HTMLButtonElement>('button[data-jeu]')];
    // Les blocs sont collés (Angular retire les blancs entre éléments) ; `\s` réduit aussi l'espace fine de fr-FR.
    expect(boutons.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Vallée de la chimiev2Risque1 234 CP · 75,9 % d’utile',
      'Fosv1Risque— CP',
    ]);
    expect(boutons[0].title).toBe('Ouvrir ce jeu dans l’atelier');
  });

  it("clic → `carte/risques?risque=etape%3Dzones%26jeu%3D<id>` (le module naît sur ④ et ce jeu)", async () => {
    const { harness, el, router } = await monter(() => of({ jeux: [jeu({})] }));
    el.querySelector<HTMLButtonElement>('button[data-jeu]')!.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe(`/carte/risques?risque=etape%3Dzones%26jeu%3D${JEU}`);
  });

  it('pendant la lecture : « Lecture des jeux de zones… » ; aucun jeu : la phrase qui dit où ils se fabriquent', async () => {
    const lecture = await monter(() => NEVER);
    expect(lecture.el.querySelector('[data-jeux-lecture]')?.textContent?.trim()).toBe('Lecture des jeux de zones…');
    TestBed.resetTestingModule();
    const vide = await monter(() => of({ jeux: [] }));
    expect(vide.el.querySelector('[data-jeux-vide]')?.textContent?.trim()).toBe(
      'Aucun jeu enregistré. Ils se fabriquent à l’étape ⑤, ou dans Calques, section Zones à risque industriel, bouton « Analyser la population à risque ».',
    );
  });

  it('échec de lecture : « Liste indisponible pour le moment. », jamais un chargement sans fin', async () => {
    const { el } = await monter(() => throwError(() => new Error('500')));
    expect(el.querySelector('[data-jeux-vide]')?.textContent?.trim()).toBe('Liste indisponible pour le moment.');
  });

  it('clic depuis `/carte?etape=zones` : l’étape du parcours survit à l’ouverture du module', async () => {
    const { harness, el, router } = await monter(() => of({ jeux: [jeu({})] }), '/carte?etape=zones');
    el.querySelector<HTMLButtonElement>('button[data-jeu]')!.click();
    await harness.fixture.whenStable();
    expect(router.url).toContain('etape=zones');
    expect(router.url).toContain(`risque=etape%3Dzones%26jeu%3D${JEU}`);
  });
  it('lot 5 (T12) : un jeu de ZONE ouvre ⑤ sur `?jeu=` (étape jeu), sans zone ni choix en cours ; la liste est lue UNE fois', async () => {
    const lister = vi.fn(() => of({ jeux: [jeu({ id: ZONE_JEU, type: 'zone', nom: 'Lycées BdR', zone_nom: 'Lycées 5 km', n_cp_retenus: null, taux_utile: null })] }));
    const { harness, el, router } = await monter(lister, '/carte?zoneJeu=0f8fad5b-d9cb-469f-a165-70867728950e&mailles=dv360.cp.20');
    const bouton = el.querySelector<HTMLButtonElement>('button[data-jeu]')!;
    expect(bouton.textContent?.replace(/\s+/g, ' ').trim()).toBe('Lycées BdRv2ZoneLycées 5 km');
    expect(bouton.title).toBe('Ouvrir ce jeu à l’étape ⑤');
    bouton.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe(`/carte?jeu=${ZONE_JEU}&etape=jeu`);
    expect(lister).toHaveBeenCalledTimes(1);
  });
});
