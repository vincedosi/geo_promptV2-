import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type maplibregl from 'maplibre-gl';
import type { Bbox } from '../../../carte/bbox';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { PROFIL_DEFAUT } from '../logique/profil';
import { CarteCodesPostauxComponent, type ChiffresCp } from './carte-codes-postaux.component';
import { CarteRisqueComponent } from './carte-risque.component';
import { TableauGrappesComponent } from './tableau-grappes.component';
import { VueCartesComponent } from './vue-cartes.component';

let detruits = 0;

@Component({ selector: 'mg-carte-risque', template: '' })
class CarteRisqueFactice {
  readonly profil = input<unknown>();
  readonly natures = input<unknown>();
  readonly gravites = input<unknown>();
  readonly fusionner = input<unknown>();
  readonly apercu = input<unknown>();
  readonly carte = output<maplibregl.Map>();
  ngOnDestroy() { detruits++; }
}

@Component({ selector: 'mg-carte-codes-postaux', template: '' })
class CarteCpFactice {
  readonly jeuId = input<string | null>(null);
  readonly codeProfil = input('');
  readonly natures = input<unknown>();
  readonly coloration = input<unknown>();
  readonly surbrillance = input<readonly string[] | null>(null);
  readonly actif = input(false);
  readonly carte = output<maplibregl.Map>();
  readonly chiffres = output<ChiffresCp | null>();
  ngOnDestroy() { detruits++; }
}

@Component({ selector: 'mg-tableau-grappes', template: '' })
class TableauFactice {
  readonly jeuId = input<string | null>(null);
  readonly actif = input(false);
  readonly recadrer = output<Bbox>();
  readonly survol = output<string[] | null>();
  ngOnDestroy() { detruits++; }
}

const JEU = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';

async function rendre(etape = 'zones', jeuId: string | null = JEU) {
  detruits = 0;
  TestBed.overrideComponent(VueCartesComponent, {
    remove: { imports: [CarteRisqueComponent, CarteCodesPostauxComponent, TableauGrappesComponent] },
    add: { imports: [CarteRisqueFactice, CarteCpFactice, TableauFactice] },
  });
  const fixture = TestBed.createComponent(VueCartesComponent);
  fixture.componentRef.setInput('etape', etape);
  fixture.componentRef.setInput('jeuId', jeuId);
  fixture.componentRef.setInput('profil', PROFIL_DEFAUT);
  await fixture.whenStable();
  const rayons = fixture.debugElement.query(By.directive(CarteRisqueFactice)).componentInstance as CarteRisqueFactice;
  const cp = fixture.debugElement.query(By.directive(CarteCpFactice)).componentInstance as CarteCpFactice;
  const a = new CarteFactice();
  const b = new CarteFactice();
  b.centre = [2.4, 46.6];
  b.zoom = 5;
  rayons.carte.emit(a as unknown as maplibregl.Map);
  cp.carte.emit(b as unknown as maplibregl.Map);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const tableau = () => fixture.debugElement.query(By.directive(TableauFactice))?.componentInstance as TableauFactice | undefined;
  return { fixture, rayons, cp, a, b, el, tableau };
}

describe('VueCartesComponent — double carte (T15)', () => {
  it('④ + jeu : deux cartes visibles, caméras liées par `jumpTo` (la droite s’aligne sur la gauche à la liaison)', async () => {
    const { a, b, el, cp } = await rendre();
    const vue = (v: string) => el.querySelector<HTMLElement>(`[data-vue="${v}"]`)!.style.visibility;
    expect([vue('rayons'), vue('codes-postaux')]).toEqual(['visible', 'visible']);
    expect(cp.actif()).toBe(true);
    // Alignement initial : la carte des codes postaux saute sur le cadre de celle des rayons.
    expect(b.sauts).toHaveLength(1);
    expect(b.zoom).toBe(9);
    expect(a.nombreEcouteurs('move')).toBe(1);
    expect(b.nombreEcouteurs('move')).toBe(1);
  });

  it('verrou de réentrance : bouger la gauche place la droite UNE fois, sans ping-pong (le `move` de B ne replace pas A)', async () => {
    const { a, b } = await rendre();
    const avantA = a.sauts.length;
    const avantB = b.sauts.length;
    a.zoom = 11;
    a.emettre('move');
    expect(b.sauts.length - avantB).toBe(1);
    expect(a.sauts.length).toBe(avantA);
    expect(b.zoom).toBe(11);
    b.zoom = 12;
    b.emettre('move');
    expect(a.sauts.length - avantA).toBe(1);
    expect(a.zoom).toBe(12);
  });

  it('quitter ④ : liaison DÉTACHÉE, aucune carte détruite, celle des codes postaux masquée à largeur nulle', async () => {
    const { fixture, a, b, el } = await rendre();
    fixture.componentRef.setInput('etape', 'couverture');
    await fixture.whenStable();
    expect(a.nombreEcouteurs('move')).toBe(0);
    expect(b.nombreEcouteurs('move')).toBe(0);
    const avant = b.sauts.length;
    a.emettre('move');
    expect(b.sauts).toHaveLength(avant);
    expect(detruits).toBe(0);
    const cpVue = el.querySelector<HTMLElement>('[data-vue="codes-postaux"]')!;
    expect([cpVue.style.visibility, cpVue.style.width]).toEqual(['hidden', '0px']);
    expect(el.querySelector('mg-tableau-grappes')!.classList.contains('hidden')).toBe(true);
    // Retour à ④ : la liaison revient, toujours les mêmes instances.
    fixture.componentRef.setInput('etape', 'zones');
    await fixture.whenStable();
    expect(a.nombreEcouteurs('move')).toBe(1);
    expect(detruits).toBe(0);
  });

  it('survol d’un bassin → `surbrillance` transmise à la carte de droite ; clic → les DEUX cartes recadrent', async () => {
    const { fixture, cp, a, b, tableau } = await rendre();
    tableau()!.survol.emit(['13270', '13500']);
    await fixture.whenStable();
    expect(cp.surbrillance()).toEqual(['13270', '13500']);
    tableau()!.survol.emit(null);
    await fixture.whenStable();
    expect(cp.surbrillance()).toBeNull();
    tableau()!.recadrer.emit([4.8, 43.3, 5.1, 43.5]);
    const attendu = { cadre: [[4.8, 43.3], [5.1, 43.5]], options: { padding: 40, duration: 600 } };
    expect(a.cadrages).toEqual([attendu]);
    expect(b.cadrages).toEqual([attendu]);
  });

  it('le bandeau des quatre chiffres, à la française ; « — » tant que rien n’est lu', async () => {
    const { fixture, cp, el } = await rendre();
    const textes = () => [...el.querySelectorAll('[data-bandeau-cp] > div')]
      .map((d) => [...d.querySelectorAll('span')].map((s) => s.textContent?.replace(/ | /g, ' ').trim()).join(' '));
    expect(textes()).toEqual(['Codes postaux du jeu —', 'Retenus par le seuil —', 'Taux d’utile —', 'Affichés dans le cadre —']);
    cp.chiffres.emit({ n_total: 1942, n_retenus: 1006, taux_utile: 81.6, n_affiches: 57 });
    await fixture.whenStable();
    expect(textes()).toEqual(['Codes postaux du jeu 1 942', 'Retenus par le seuil 1 006', 'Taux d’utile 81,6 %', 'Affichés dans le cadre 57']);
  });

  it('sans jeu : pas de double vue, pas de liaison, pas de tableau monté', async () => {
    const { a, el, tableau } = await rendre('zones', null);
    expect(a.nombreEcouteurs('move')).toBe(0);
    expect(el.querySelector('[data-bandeau-cp]')).toBeNull();
    expect(tableau()).toBeUndefined();
  });

  it('la coloration choisie est relayée à la carte des codes postaux', async () => {
    const { fixture, cp, el } = await rendre();
    const boutons = [...el.querySelectorAll<HTMLButtonElement>('[data-coloration] button')];
    expect(boutons.map((x) => x.textContent?.trim())).toEqual(['Part du plan', 'Taux d’exposition', 'Population exposée']);
    boutons[1].click();
    await fixture.whenStable();
    expect(cp.coloration()).toBe('exposition');
    expect(boutons[1].getAttribute('aria-pressed')).toBe('true');
  });
});
