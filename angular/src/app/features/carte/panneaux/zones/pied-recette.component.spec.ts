import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { formaterNombre } from '../../../../core/format/nombre';
import type { ApercuZone } from '../../data/zones.api';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import type { Recette } from '../../logique/zones/recette';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { PiedRecetteComponent } from './pied-recette.component';

const SEUIL: Recette = { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '13' } };
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

function monter() {
  const atelier = {
    recette: signal<Recette | null>(null), apercu: signal<ApercuZone | null>(null), enCours: signal(false),
    erreur: signal<string | null>(null), message: signal<string | null>(null), nonResolue: signal<{ id: string; recalculable: boolean } | null>(null),
    apercevoir: vi.fn(), enregistrer: vi.fn(), effacer: vi.fn(),
  };
  const ouvrir = vi.fn();
  TestBed.configureTestingModule({ providers: [{ provide: AtelierZoneService, useValue: atelier }, { provide: OutilsCarteService, useValue: { ouvrir } }] });
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
    expect(nom.value).toBe('Carreaux où part des ménages pauvres ≥ 40 %');
    nom.value = 'Nom saisi'; nom.dispatchEvent(new Event('input'));
    await stable();
    expect(b('[data-enregistrer]').disabled).toBe(false);
    b('[data-enregistrer]').click();
    expect(atelier.enregistrer).toHaveBeenCalledWith('Nom saisi');
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
