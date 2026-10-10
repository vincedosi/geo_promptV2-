import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { PileEchapService } from '../etat/pile-echap.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { COUCHES_DESSIN, DessinService, SOURCE_DESSIN } from './dessin.service';

function monter() {
  const theme = signal({ teal: '#4ecdc4' });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), DessinService, CouchesCarteService, EtatCarteService, AnnonceService, PileEchapService,
      { provide: CouleursService, useValue: { palette: () => theme } },
    ],
  });
  const couches = TestBed.inject(CouchesCarteService);
  const carte = new CarteFactice();
  carte.styleCharge = true;
  couches.publier(carte as unknown as maplibregl.Map);
  return { dessin: TestBed.inject(DessinService), etat: TestBed.inject(EtatCarteService), couches, carte, theme };
}

const flush = () => TestBed.tick();
/** Projection factice identité : le pixel du clic EST la position. */
const clic = (c: CarteFactice, x: number, y: number) => c.emettre('click', { lngLat: { lng: x, lat: y }, point: { x, y } });
const doubleClic = (c: CarteFactice, x: number, y: number) => {
  clic(c, x, y);
  clic(c, x, y);
  c.emettre('dblclick', { lngLat: { lng: x, lat: y }, point: { x, y }, preventDefault: () => undefined });
};
const touche = (c: CarteFactice, key: string) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  c.getContainer().dispatchEvent(e);
  return e;
};
const donnees = (c: CarteFactice) => c.sources.get(SOURCE_DESSIN)!.donnees.at(-1) as GeoJSON.FeatureCollection;

describe('DessinService — tracé libre maison (B8)', () => {
  it('inactif : aucune écoute, aucune couche, rien de coupé', () => {
    const { carte } = monter();
    flush();
    expect(carte.nombreEcouteurs('click')).toBe(0);
    expect(carte.sources.has(SOURCE_DESSIN)).toBe(false);
    expect(carte.doubleClickZoom.isEnabled()).toBe(true);
  });

  it('démarré : source `dessin-trace`, couches remplissage/ligne/point en teal LU (jamais var()), zoom au double-clic coupé', () => {
    const { dessin, carte } = monter();
    dessin.demarrer();
    flush();
    expect(carte.sources.has(SOURCE_DESSIN)).toBe(true);
    expect(carte.couches.map((c) => c.couche['id'])).toEqual([...COUCHES_DESSIN]);
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
    expect(JSON.stringify(carte.couches)).toContain('#4ecdc4');
    expect(carte.doubleClickZoom.isEnabled()).toBe(false);
    expect(carte.getCanvas().style.cursor).toBe('crosshair');
  });

  it('3 clics + double-clic → polygone fermé de 4 positions, remonté par `traceFerme` ; dragPan coupé PENDANT le tracé seulement', () => {
    const { dessin, carte } = monter();
    dessin.demarrer();
    flush();
    clic(carte, 0, 0);
    flush();
    expect(carte.dragPan.isEnabled()).toBe(false);
    clic(carte, 100, 0);
    clic(carte, 100, 100);
    expect(dessin.traceFerme()).toBeNull();
    doubleClic(carte, 100, 100);
    flush();
    expect(dessin.traceFerme()!.coordinates[0]).toEqual([[0, 0], [100, 0], [100, 100], [0, 0]]);
    expect(dessin.aide()).toBe('3 sommets tracés');
    expect(carte.dragPan.isEnabled()).toBe(true);
    expect(donnees(carte).features.map((f) => f.geometry.type)).toEqual(['Polygon']);
  });

  it('`Backspace` retire le dernier sommet (frappe CONSOMMÉE) ; sans tracé en cours, elle passe', () => {
    const { dessin, carte } = monter();
    dessin.demarrer();
    flush();
    clic(carte, 0, 0);
    clic(carte, 100, 0);
    const e = touche(carte, 'Backspace');
    expect(e.defaultPrevented).toBe(true);
    expect(dessin.aide()).toBe('1 sommet tracé');
    touche(carte, 'Backspace');
    expect(touche(carte, 'Backspace').defaultPrevented).toBe(false);
  });

  it('Échap annule le tracé EN COURS sans rien d’autre ; tracé vide, il n’est plus dans la pile (revue 1)', () => {
    const { dessin, carte } = monter();
    const pile = TestBed.inject(PileEchapService);
    pile.empiler('panneau', () => undefined);
    dessin.demarrer();
    flush();
    clic(carte, 0, 0);
    clic(carte, 100, 0);
    flush();
    expect(pile.etat().map((e) => e.id)).toEqual(['panneau', 'dessin-trace']);
    pile.fermerLePlusHaut();
    flush();
    expect(dessin.nombreSommets()).toBe(0);
    expect(pile.etat().map((e) => e.id)).toEqual(['panneau']);
  });

  it('un seul outil reçoit les clics : la carte prise par le rayon, le dessin ignore le clic ; rendue, il le reprend (revue 1)', () => {
    const { dessin, carte, etat } = monter();
    dessin.demarrer();
    flush();
    etat.prendreCarte('rayon');
    clic(carte, 0, 0);
    expect(dessin.nombreSommets()).toBe(0);
    etat.rendreCarte('rayon');
    clic(carte, 0, 0);
    expect(dessin.nombreSommets()).toBe(1);
  });

  it('rectangle : deux clics → 5 positions', () => {
    const { dessin, carte } = monter();
    dessin.demarrer();
    dessin.choisirMode('rectangle');
    flush();
    clic(carte, 0, 0);
    clic(carte, 50, 20);
    expect(dessin.traceFerme()!.coordinates[0]).toHaveLength(5);
  });

  it('effacer vide le tracé ; arrêter retire couches, source et écoutes, et rend dragPan, double-clic et curseur', () => {
    const { dessin, carte } = monter();
    dessin.demarrer();
    flush();
    clic(carte, 0, 0);
    flush();
    dessin.effacer();
    expect(dessin.nombreSommets()).toBe(0);
    dessin.arreter();
    flush();
    expect(carte.sources.has(SOURCE_DESSIN)).toBe(false);
    expect(carte.couches).toEqual([]);
    expect(carte.nombreEcouteurs('click')).toBe(0);
    expect(carte.dragPan.isEnabled()).toBe(true);
    expect(carte.doubleClickZoom.isEnabled()).toBe(true);
    expect(carte.getCanvas().style.cursor).toBe('');
  });

  it('la carte est prise pendant le dessin : un clic sur la carte ne ferme pas le panneau', () => {
    const { dessin, etat } = monter();
    expect(etat.carteOccupee()).toBe(false);
    dessin.demarrer();
    expect(etat.carteOccupee()).toBe(true);
    dessin.arreter();
    expect(etat.carteOccupee()).toBe(false);
  });

  it('« Tout effacer » efface le tracé ; changer de fond (nouvelle instance) re-pose le dessin (B11)', () => {
    const { dessin, carte, couches } = monter();
    dessin.demarrer();
    flush();
    clic(carte, 0, 0);
    couches.toutEffacer();
    expect(dessin.nombreSommets()).toBe(0);
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    flush();
    expect(nouvelle.sources.has(SOURCE_DESSIN)).toBe(true);
    expect(nouvelle.nombreEcouteurs('click')).toBe(1);
    expect(carte.nombreEcouteurs('click')).toBe(0);
  });

  it('le thème change : le teal est repeint sans recréer la couche', () => {
    const { dessin, carte, theme } = monter();
    dessin.demarrer();
    flush();
    theme.set({ teal: '#3dbdb5' });
    flush();
    expect(carte.peintures.some((p) => p.valeur === '#3dbdb5')).toBe(true);
  });
});
