import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { formaterNombre } from '../../../../core/format/nombre';
import type { ApercuZone } from '../../data/zones.api';
import { type Observable, Subject, of } from 'rxjs';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import type { Recette } from '../../logique/zones/recette';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { PiedRecetteComponent } from './pied-recette.component';

const SEUIL: Recette = { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '13' }, min_menages: 11 };
const APERCU: ApercuZone = { geometry: { type: 'MultiPolygon', coordinates: [] }, surface_km2: 3.2, compte: 505, part_retenue: 0.87, population: 41230 };
const FORME: GeoJSON.Geometry = { type: 'MultiPolygon', coordinates: [] };

@Component({
  imports: [PiedRecetteComponent],
  template: `<mg-pied-recette [recette]="recette()" [geometrie]="geometrie()" />`,
})
class Hote {
  readonly recette = signal<Recette | null>(null);
  readonly geometrie = signal<GeoJSON.Geometry | undefined>(undefined);
}

function monter(lecture: () => Observable<unknown> = () => of([{ indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: 'Revenus', unit: '%' }])) {
  const charger = vi.fn(lecture);
  const atelier = {
    recette: signal<Recette | null>(null), apercu: signal<ApercuZone | null>(null), enCours: signal(false),
    erreur: signal<string | null>(null), message: signal<string | null>(null), nonResolue: signal<{ id: string; recalculable: boolean } | null>(null),
    apercevoir: vi.fn(), enregistrer: vi.fn(), effacer: vi.fn(),
  };
  const ouvrir = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: AtelierZoneService, useValue: atelier }, { provide: OutilsCarteService, useValue: { ouvrir } },
      { provide: CatalogueIndicateursService, useValue: { charger } },
    ],
  });
  const f = TestBed.createComponent(Hote);
  const el = f.nativeElement as HTMLElement;
  const stable = async () => { await f.whenStable(); };
  const b = (s: string) => el.querySelector<HTMLButtonElement>(s)!;
  return { f, el, stable, atelier, ouvrir, b };
}

describe('PiedRecetteComponent (lot 3, T10, arbitrage P4)', () => {
  it('« Aperçu » désactivé sans recette ; avec une recette, il appelle l’atelier (géométrie d’une forme figée comprise)', async () => {
    const { f, stable, atelier, b } = monter();
    await stable();
    expect(b('[data-apercu]').disabled).toBe(true);
    f.componentInstance.recette.set(SEUIL);
    await stable();
    b('[data-apercu]').click();
    expect(atelier.apercevoir).toHaveBeenCalledWith(SEUIL, undefined);
    const imp: Recette = { v: 1, type: 'import', format: 'kml', fichier: 'a.kml' };
    f.componentInstance.recette.set(imp);
    f.componentInstance.geometrie.set(FORME);
    await stable();
    b('[data-apercu]').click();
    expect(atelier.apercevoir).toHaveBeenLastCalledWith(imp, FORME);
  });

  it('chiffres de l’aperçu mis en forme par formaterNombre, part retenue < 98 % dite', async () => {
    const { f, el, stable, atelier } = monter();
    f.componentInstance.recette.set(SEUIL);
    atelier.recette.set(SEUIL);
    atelier.apercu.set(APERCU);
    await stable();
    expect(el.querySelector('[data-chiffres]')!.textContent!.trim()).toBe(`3,2 km² · 505 carreaux · ${formaterNombre(41230)} habitants`);
    expect(el.querySelector('[data-part]')!.textContent!.trim()).toBe('87 % de la forme dans le périmètre');
    atelier.apercu.set({ ...APERCU, part_retenue: 0.99 });
    await stable();
    expect(el.querySelector('[data-part]')).toBeNull();
    // Une forme figée (import) est découpée par le territoire, pas par le périmètre ; ni compte ni population.
    atelier.recette.set({ v: 1, type: 'import', format: 'kml', fichier: 'a.kml' });
    atelier.apercu.set({ ...APERCU, compte: null, population: null, part_retenue: 0.84 });
    await stable();
    expect(el.querySelector('[data-chiffres]')!.textContent!.trim()).toBe('3,2 km²');
    expect(el.querySelector('[data-part]')!.textContent!.trim()).toBe('84 % de la forme sur le territoire');
    expect(el.querySelector('[data-communes-entieres]')).toBeNull();
  });

  it('D30 : seuil sur territoires à l’IRIS — communes entières et non évaluables, seulement s’il y en a', async () => {
    const { f, el, stable, atelier } = monter();
    const TERR: Recette = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'region', code: '84' } };
    f.componentInstance.recette.set(TERR);
    atelier.recette.set(TERR);
    atelier.apercu.set({ ...APERCU, part_retenue: null, population: null, compte: 2571, communes_entieres: 1041, non_evaluables: 12 });
    await stable();
    expect(el.querySelector('[data-chiffres]')!.textContent!.trim()).toBe(`3,2 km² · ${formaterNombre(2571)} territoires`);
    expect(el.querySelector('[data-communes-entieres]')!.textContent!.trim()).toBe(`${formaterNombre(1041)} communes entières traitées chacune comme un seul IRIS`);
    expect(el.querySelector('[data-non-evaluables]')!.textContent!.trim()).toBe('12 unités non évaluables (valeur absente), jamais retenues');
    atelier.apercu.set({ ...APERCU, part_retenue: null, communes_entieres: 0, non_evaluables: 0 });
    await stable();
    expect(el.querySelector('[data-communes-entieres]')).toBeNull();
    expect(el.querySelector('[data-non-evaluables]')).toBeNull();
  });

  it('nom par défaut = libellé de la recette ; « Enregistrer la zone » désactivé sans aperçu, puis atelier.enregistrer(nom saisi)', async () => {
    const { f, el, stable, atelier, b } = monter();
    await stable();
    expect(b('[data-enregistrer]').disabled).toBe(true);
    f.componentInstance.recette.set(SEUIL);
    atelier.recette.set(SEUIL);
    atelier.apercu.set(APERCU);
    await stable();
    const nom = el.querySelector<HTMLInputElement>('[data-nom]')!;
    expect(nom.value).toBe('Carreaux où part des ménages pauvres ≥ 40 % · minimum de ménages : 11');
    nom.value = 'Nom saisi'; nom.dispatchEvent(new Event('input'));
    await stable();
    expect(b('[data-enregistrer]').disabled).toBe(false);
    b('[data-enregistrer]').click();
    expect(atelier.enregistrer).toHaveBeenCalledWith('Nom saisi');
  });

  it('seuil sur territoires : le nom par défaut porte le libellé du catalogue et son unité, jamais l’identifiant', async () => {
    const { f, el, stable, atelier } = monter();
    const territoire: Recette = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 30, perimetre: { type: 'departement', code: '13' } };
    f.componentInstance.recette.set(territoire);
    atelier.recette.set(territoire);
    await stable();
    expect(el.querySelector<HTMLInputElement>('[data-nom]')!.value).toBe('Territoires où taux de pauvreté ≥ 30 %');
  });

  it('catalogue arrivé APRÈS une saisie : le nom saisi est gardé ; pas touché, il prend le libellé ; une autre recette le réinitialise', async () => {
    const catalogue = new Subject<{ indicator_code: string; label: string; famille: string | null; unit: string | null }[]>();
    const { f, el, stable, atelier } = monter(() => catalogue);
    const territoire: Recette = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 30, perimetre: { type: 'departement', code: '13' } };
    f.componentInstance.recette.set(territoire);
    atelier.recette.set(territoire);
    await stable();
    const nom = el.querySelector<HTMLInputElement>('[data-nom]')!;
    expect(nom.value).toBe('Territoires où taux_pauvrete ≥ 30');
    nom.value = 'Mon nom'; nom.dispatchEvent(new Event('input'));
    await stable();
    catalogue.next([{ indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: 'Revenus', unit: '%' }]);
    await stable();
    expect(nom.value).toBe('Mon nom');
    // Une autre recette : le nom repart de son libellé (catalogue compris).
    const autre: Recette = { ...territoire, seuil: 25 };
    atelier.recette.set(autre);
    await stable();
    expect(nom.value).toBe('Territoires où taux de pauvreté ≥ 25 %');
  });

  it('catalogue arrivé APRÈS l’aperçu, nom non touché : le libellé du catalogue remplace l’identifiant', async () => {
    const catalogue = new Subject<{ indicator_code: string; label: string; famille: string | null; unit: string | null }[]>();
    const { f, el, stable, atelier } = monter(() => catalogue);
    const territoire: Recette = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 30, perimetre: { type: 'departement', code: '13' } };
    f.componentInstance.recette.set(territoire);
    atelier.recette.set(territoire);
    await stable();
    catalogue.next([{ indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: 'Revenus', unit: '%' }]);
    await stable();
    expect(el.querySelector<HTMLInputElement>('[data-nom]')!.value).toBe('Territoires où taux de pauvreté ≥ 30 %');
  });

  it('écriture en vol : « Enregistrer » et « Effacer » désactivés dès le premier clic ; un second clic n’envoie rien', async () => {
    const { f, stable, atelier, b } = monter();
    f.componentInstance.recette.set(SEUIL);
    atelier.recette.set(SEUIL);
    atelier.apercu.set(APERCU);
    atelier.enregistrer.mockImplementation(() => atelier.enCours.set(true));
    await stable();
    b('[data-enregistrer]').click();
    await stable();
    expect(b('[data-enregistrer]').disabled).toBe(true);
    expect(b('[data-enregistrer]').textContent!.trim()).toBe('Enregistrement…');
    expect(b('[data-effacer]').disabled).toBe(true);
    b('[data-enregistrer]').click();
    expect(atelier.enregistrer).toHaveBeenCalledTimes(1);
  });

  it('réglages changés depuis l’aperçu : l’enregistrement attend un nouvel aperçu', async () => {
    const { f, el, stable, atelier, b } = monter();
    atelier.recette.set(SEUIL);
    atelier.apercu.set(APERCU);
    f.componentInstance.recette.set({ ...SEUIL, seuil: 50 });
    await stable();
    expect(el.querySelector('[data-perime]')).not.toBeNull();
    expect(b('[data-enregistrer]').disabled).toBe(true);
  });

  it('plus de formulaire actif (famille repliée, ① passé à la France) : l’ancien aperçu ne s’enregistre plus', async () => {
    const { f, el, stable, atelier, b } = monter();
    f.componentInstance.recette.set(SEUIL);
    atelier.recette.set(SEUIL);
    atelier.apercu.set(APERCU);
    await stable();
    expect(b('[data-enregistrer]').disabled).toBe(false);
    f.componentInstance.recette.set(null);
    await stable();
    expect(el.querySelector('[data-perime]')).not.toBeNull();
    expect(b('[data-enregistrer]').disabled).toBe(true);
  });

  it('import : un AUTRE fichier de même nom (autre forme) rend l’aperçu périmé', async () => {
    const { f, el, stable, atelier, b } = monter();
    const imp: Recette = { v: 1, type: 'import', format: 'geojson', fichier: 'zones.geojson' };
    f.componentInstance.recette.set(imp);
    f.componentInstance.geometrie.set(FORME);
    await stable();
    b('[data-apercu]').click();
    atelier.recette.set(imp);
    atelier.apercu.set(APERCU);
    await stable();
    expect(el.querySelector('[data-perime]')).toBeNull();
    expect(b('[data-enregistrer]').disabled).toBe(false);
    f.componentInstance.geometrie.set({ type: 'MultiPolygon', coordinates: [] });
    await stable();
    expect(el.querySelector('[data-perime]')).not.toBeNull();
    expect(b('[data-enregistrer]').disabled).toBe(true);
  });

  it('erreur (alerte) et message (statut) de l’atelier ; un 207 recalculable propose « Mes zones »', async () => {
    const { el, stable, atelier, ouvrir, b } = monter();
    atelier.erreur.set('Choisissez un périmètre à l’étape ① avant ce calcul.');
    atelier.message.set('Zone créée ; ses codes postaux n’ont pas pu être résolus.');
    atelier.nonResolue.set({ id: 'z', recalculable: true });
    await stable();
    expect(el.querySelector('[data-erreur]')!.getAttribute('role')).toBe('alert');
    expect(el.querySelector('[data-message]')!.getAttribute('role')).toBe('status');
    b('[data-mes-zones]').click();
    expect(ouvrir).toHaveBeenCalledWith('zones');
    b('[data-effacer]').click();
    expect(atelier.effacer).toHaveBeenCalled();
  });
});

describe('PiedRecetteComponent — rayon POI sous 250 m (décision du 02/11)', () => {
  it('l’aperçu d’un rayon POI de 100 m est calculé, et dit estimatif ; rien pour 5 km', async () => {
    const { f, el, stable, atelier } = monter();
    const poi = (rayon_m: number): Recette => ({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m, perimetre: { type: 'departement', code: '13' } });
    f.componentInstance.recette.set(poi(100));
    atelier.recette.set(poi(100));
    atelier.apercu.set(APERCU);
    await stable();
    expect(el.querySelector('[data-chiffres]')).not.toBeNull();
    expect(el.querySelector('[data-estimatif]')?.textContent?.trim()).toBe(
      'Chiffres estimatifs : un rayon de 100 m est plus fin que les carreaux INSEE de 200 m. '
      + 'Zone gardée pour l’analyse, jamais activée (minimum 250 m).');
    atelier.recette.set(poi(5000));
    f.componentInstance.recette.set(poi(5000));
    await stable();
    expect(el.querySelector('[data-estimatif]')).toBeNull();
  });
});
