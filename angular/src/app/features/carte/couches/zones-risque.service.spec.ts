import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { COUCHES_ZONES, ID_CONTOUR, ID_ETIQUETTES, ID_FOND, ID_PPRT, SOURCE_ZONES } from '../../risques/cartes/couches-zones';
import { ZonesRisqueApi } from '../../risques/data/zones-risque.api';
import { codeProfil } from '../../risques/logique/code-profil';
import { PROFIL_DEFAUT, type ProfilRayons } from '../../risques/logique/profil';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { ZonesRisqueService } from './zones-risque.service';

/** La vraie adresse de `ZonesRisqueApi.urlTuilesZones`, sans configuration : le service doit la poser telle quelle. */
const urlTuiles = (code: string, natures: string[] = []) =>
  `/api/tiles/zones-risque/{z}/{x}/{y}?profil=${encodeURIComponent(code)}`
  + (natures.length ? `&natures=${encodeURIComponent(natures.join(','))}` : '');

const AUTRE_PROFIL: ProfilRayons = { ...PROFIL_DEFAUT, haut: [1000, 3000] };

function monter() {
  const teintes = signal({ haut: 'rgb(1, 0, 0)', bas: 'rgb(2, 0, 0)', autres: 'rgb(3, 0, 0)', halo: 'rgb(0, 0, 0)' });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), ZonesRisqueService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: ZonesRisqueApi, useValue: { urlTuilesZones: (code: string, natures: string[] = []) => urlTuiles(code, natures) } },
      { provide: CouleursService, useValue: { palette: () => teintes } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(ZonesRisqueService);
  TestBed.tick();
  return { service, carte, couches, etat: TestBed.inject(EtatCarteService), annonce: TestBed.inject(AnnonceService), teintes };
}

const tuilesPosees = (c: CarteFactice) => (c.sources.get(SOURCE_ZONES)?.spec as { tiles?: string[] } | undefined)?.tiles?.[0];

describe('ZonesRisqueService (pont de la carte, B3)', () => {
  it("éteint par défaut : aucune source, aucun dégradé", () => {
    const { carte, etat } = monter();
    expect(carte.sources.has(SOURCE_ZONES)).toBe(false);
    expect(etat.degradeActif()).toBeNull();
  });

  it('afficher → addSource avec `urlTuilesZones(code, natures)` (natures COMPRISES, défaut React corrigé) et TROIS couches, sans étiquette', () => {
    const { service, carte } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: ['Toxicité aiguë'] });
    TestBed.tick();
    expect(tuilesPosees(carte)).toBe(urlTuiles(codeProfil(PROFIL_DEFAUT), ['Toxicité aiguë']));
    // Parité ZonesRisqueLayer.tsx : fond, contour tireté, contour PPRT — aucune étiquette de rayon (revue 1).
    expect(carte.couches.map((c) => c.couche['id'])).toEqual([ID_FOND, ID_CONTOUR, ID_PPRT]);
    expect(carte.getLayer(ID_ETIQUETTES)).toBeUndefined();
    // Régime de la carte principale : peint dès le plancher des tuiles, comme ZonesRisqueLayer.tsx.
    expect((carte.getLayer(ID_FOND) as { minzoom?: number }).minzoom).toBe(4);
  });

  it("réclame le dégradé `zones-risque` : l'IRIS allumé est ÉVINCÉ et l'annonce le nomme", () => {
    const { service, etat, annonce } = monter();
    const irisEteint = vi.fn();
    etat.surEviction('iris', irisEteint);
    etat.basculerDegrade('iris', true);
    const annoncer = vi.spyOn(annonce, 'annoncer');
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    expect(etat.degradeActif()).toBe('zones-risque');
    expect(irisEteint).toHaveBeenCalledTimes(1);
    expect(annoncer).toHaveBeenCalledWith('IRIS a été masqué — un seul dégradé de couleur à la fois');
  });

  it('`null` → couches puis source retirées, dégradé libéré', () => {
    const { service, carte, etat } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    TestBed.tick();
    service.afficherZonesRisque(null);
    TestBed.tick();
    expect(carte.sources.has(SOURCE_ZONES)).toBe(false);
    expect(COUCHES_ZONES.some((id) => carte.getLayer(id))).toBe(false);
    expect(carte.retraits.at(-1)).toBe(`source:${SOURCE_ZONES}`);
    expect(etat.degradeActif()).toBeNull();
  });

  it('évincé par un autre dégradé (carreaux) : les zones s’éteignent', () => {
    const { service, carte, etat } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    TestBed.tick();
    etat.basculerDegrade('carreaux', true);
    TestBed.tick();
    expect(service.affichees()).toBeNull();
    expect(carte.sources.has(SOURCE_ZONES)).toBe(false);
  });

  it('« Tout effacer » éteint les zones', () => {
    const { service, carte, couches } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(service.affichees()).toBeNull();
    expect(carte.sources.has(SOURCE_ZONES)).toBe(false);
  });

  it('nouveau profil → source RECRÉÉE sur la nouvelle adresse ; même code → rien de reposé', () => {
    const { service, carte } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    TestBed.tick();
    const poses = carte.couches.length;
    service.afficherZonesRisque({ profil: { ...PROFIL_DEFAUT }, natures: [] });
    TestBed.tick();
    expect(carte.couches.length).toBe(poses);
    service.afficherZonesRisque({ profil: AUTRE_PROFIL, natures: [] });
    TestBed.tick();
    expect(tuilesPosees(carte)).toBe(urlTuiles(codeProfil(AUTRE_PROFIL)));
    expect(carte.retraits).toContain(`source:${SOURCE_ZONES}`);
  });

  it('bascule de thème : repeinture seule (`setPaintProperty`), aucune source recréée', () => {
    const { service, carte, teintes } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    TestBed.tick();
    const sources = carte.retraits.length;
    teintes.set({ haut: 'rgb(9, 0, 0)', bas: 'rgb(8, 0, 0)', autres: 'rgb(7, 0, 0)', halo: 'rgb(255, 255, 255)' });
    TestBed.tick();
    expect(carte.retraits.length).toBe(sources);
    expect(carte.peintures.some((p) => p.couche === ID_FOND && JSON.stringify(p.valeur).includes('rgb(9, 0, 0)'))).toBe(true);
  });

  it('carte recréée par un changement de fond (B11) : les zones sont RE-POSÉES sur la nouvelle instance', () => {
    const { service, couches } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(tuilesPosees(nouvelle)).toBe(urlTuiles(codeProfil(PROFIL_DEFAUT)));
  });

  it('`recadrer` → fitBounds avec la marge de React (48 px, 900 ms)', () => {
    const { service, carte } = monter();
    service.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [], recadrer: [4.7, 45.5, 5, 45.8] });
    expect(carte.cadrages).toEqual([{ cadre: [[4.7, 45.5], [5, 45.8]], options: { padding: 48, duration: 900 } }]);
  });
});
