import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { NEVER } from 'rxjs';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarreauxService } from '../couches/carreaux.service';
import { IrisService } from '../couches/iris.service';
import { CarreauxApi } from '../data/carreaux.api';
import { IrisApi } from '../data/iris.api';
import { AnnonceService } from './annonce.service';
import { type SourceCapture, CaptureService } from './capture.service';
import { CouchesCarteService } from './couches-carte.service';
import { EtatCarteService } from './etat-carte.service';

function monter() {
  const theme = signal({ absente: '#9aa0a6', trait: '#555555' });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CaptureService, CarreauxService, IrisService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarreauxApi, useValue: { urlTuiles: () => 'http://localhost/api/tiles/{z}/{x}/{y}' } },
      { provide: IrisApi, useValue: { urlTuiles: () => 'http://localhost/api/tiles/iris/{z}/{x}/{y}', bornes: () => NEVER, detail: () => NEVER } },
      { provide: CouleursService, useValue: { palette: () => theme } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  carte.cadre = [5.2, 43.2, 5.5, 43.4];
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  return {
    capture: TestBed.inject(CaptureService),
    carreaux: TestBed.inject(CarreauxService),
    iris: TestBed.inject(IrisService),
  };
}

describe('CaptureService (CustomGeoCaptureContext + CaptureLayers)', () => {
  it('aucune couche allumée : aucune source, compte 0 (le bouton « Capturer » est inactif)', () => {
    const { capture } = monter();
    expect(capture.sources()).toEqual([]);
    expect(capture.compte()).toBe(0);
  });

  it('carreaux allumés et un IRIS sélectionné : DEUX sources, déclarées par leurs services, pas par une liste', () => {
    const { capture, carreaux, iris } = monter();
    carreaux.basculer(true);
    iris.selectionner('132010101');
    const sources = capture.sources();
    expect(sources.map((s) => [s.id, s.sourceType, s.label])).toEqual([
      ['map-carreaux-filosofi', 'carreaux_filosofi', 'Carreaux 200m population_totale'],
      ['map-iris-selection', 'iris_selection', 'IRIS 132010101'],
    ]);
    expect(capture.compte()).toBe(2);
  });

  it('les corps partent tels que React les envoyait — carreaux : emprise VISIBLE lue au moment de la capture', () => {
    const { capture, carreaux, iris } = monter();
    carreaux.basculer(true);
    iris.selectionner('132010101');
    const [c, i] = capture.sources() as [SourceCapture, SourceCapture];
    expect(c.obtenir).toMatchObject({ route: 'carreaux' });
    expect('corps' in c.obtenir && c.obtenir.corps()).toEqual({
      bbox: [5.2, 43.2, 5.5, 43.4], zoom_level: 14, indicateur: 'population_totale', max_rows: 1500, admin_scope: null,
    });
    expect('corps' in i.obtenir && i.obtenir.corps()).toEqual({ iris_codes: ['132010101'] });
    expect(c.metadata).toEqual({ indicateur: 'population_totale', selected_bucket: null, admin_scope: null });
  });

  it('éteindre la couche la retire : la liste suit l’état, sans désinscription à écrire', () => {
    const { capture, carreaux } = monter();
    carreaux.basculer(true);
    expect(capture.compte()).toBe(1);
    carreaux.basculer(false);
    expect(capture.compte()).toBe(0);
  });
});
