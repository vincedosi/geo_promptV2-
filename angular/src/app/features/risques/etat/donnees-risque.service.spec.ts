import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { type Bandes, ProfilRisqueApi, type RequeteBandes } from '../data/profil-risque.api';
import { ReferentielApi, type ReponseRefGeo } from '../data/referentiel.api';
import { SitesRisqueApi } from '../data/sites-risque.api';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { PROFIL_DEFAUT } from '../logique/profil';
import { DELAI_BANDES_MS, DonneesRisqueService } from './donnees-risque.service';
import { EtatRisqueService, PARAM_RISQUE } from './etat-risque.service';

/** Un appel d'API factice : ses arguments, et le `Subject` par lequel le test répond quand il veut. */
interface Appel<A> { args: A; rep: Subject<unknown>; annule: boolean }

function fausseApi<A>() {
  const appels: Appel<A>[] = [];
  const appeler = (args: A) => {
    const rep = new Subject<unknown>();
    const appel: Appel<A> = { args, rep, annule: false };
    appels.push(appel);
    return new Observable<never>((o) => {
      const s = rep.subscribe(o as never);
      // Le désabonnement EST l'annulation : HttpClient abandonne alors la requête.
      return () => { appel.annule = true; s.unsubscribe(); };
    });
  };
  return { appels, appeler };
}

const REF: ReponseRefGeo = {
  regions: [
    { code_region: '84', nom_region: 'Auvergne-Rhône-Alpes', depts: [{ code_dept: '01', nom_dept: 'Ain' }] },
    { code_region: '93', nom_region: 'Provence-Alpes-Côte d’Azur', depts: [
      { code_dept: '13', nom_dept: 'Bouches-du-Rhône' }, { code_dept: '84', nom_dept: 'Vaucluse' },
    ] },
  ],
};

const BANDES = (total: number) => ({ total }) as unknown as Bandes;

function creer(brut?: string) {
  const bandes = fausseApi<RequeteBandes>();
  const courbe = fausseApi<[string, unknown]>();
  const sites = fausseApi<unknown>();
  const cibles = fausseApi<void>();
  const geo = fausseApi<void>();
  const contours = fausseApi<string>();
  const route = { snapshot: { queryParamMap: convertToParamMap(brut === undefined ? {} : { [PARAM_RISQUE]: brut }) } };
  TestBed.configureTestingModule({
    providers: [
      ChargementService, EtatRisqueService, DonneesRisqueService,
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
      { provide: ProfilRisqueApi, useValue: { bandes: bandes.appeler, cibles: () => cibles.appeler() } },
      { provide: ZonesRisqueApi, useValue: { courbe: (g: string, f: unknown) => courbe.appeler([g, f]) } },
      { provide: SitesRisqueApi, useValue: { compter: sites.appeler } },
      { provide: ReferentielApi, useValue: { geo: () => geo.appeler(), contours: contours.appeler } },
    ],
  });
  const service = TestBed.inject(DonneesRisqueService);
  const etat = TestBed.inject(EtatRisqueService);
  TestBed.tick();
  return { service, etat, bandes, courbe, sites, cibles, geo, contours };
}

/** Avance le temps ET laisse tourner les effets. */
function avancer(ms: number) {
  vi.advanceTimersByTime(ms);
  TestBed.tick();
}

describe('DonneesRisqueService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ouvre sur un appel de bandes APRÈS 400 ms, une courbe et un compte de sites tout de suite', () => {
    const { service, bandes, courbe, sites } = creer();
    expect(courbe.appels).toHaveLength(1);
    expect(sites.appels).toHaveLength(1);
    expect(bandes.appels).toHaveLength(0);
    expect(service.bandes().etat).toBe('chargement');
    avancer(DELAI_BANDES_MS);
    expect(bandes.appels).toHaveLength(1);
    expect(bandes.appels[0].args).toEqual({
      profil: 'h1000.2000.5000_b500.1000_a_L0_P1', cible: 'ind', maille: 'region', parent: null, region: null, natures: [],
    });
  });

  it('(a) deux changements de profil à 100 ms d’intervalle → UN appel de bandes, sur le second', () => {
    const { etat, bandes } = creer();
    avancer(DELAI_BANDES_MS);
    bandes.appels[0].rep.next(BANDES(1));
    etat.maj({ profil: { ...PROFIL_DEFAUT, haut: [1000, 2000, 4000] } });
    TestBed.tick();
    avancer(100);
    etat.maj({ profil: { ...PROFIL_DEFAUT, haut: [1000, 2000, 3000] } });
    TestBed.tick();
    avancer(DELAI_BANDES_MS - 1);
    expect(bandes.appels).toHaveLength(1);
    avancer(1);
    expect(bandes.appels).toHaveLength(2);
    expect(bandes.appels[1].args.profil).toBe('h1000.2000.3000_b500.1000_a_L0_P1');
  });

  it('(b) la réponse du PREMIER réglage, arrivée après celle du second, est ignorée — et sa requête annulée', () => {
    const { service, etat, bandes } = creer();
    avancer(DELAI_BANDES_MS);
    const premier = bandes.appels[0];
    etat.maj({ profil: { ...PROFIL_DEFAUT, haut: [1000, 2000, 4000] } });
    TestBed.tick();
    // Le nouveau réglage annule TOUT DE SUITE l'appel en cours, avant même la fin de l'anti-rebond.
    expect(premier.annule).toBe(true);
    avancer(DELAI_BANDES_MS);
    const second = bandes.appels[1];
    second.rep.next(BANDES(2));
    premier.rep.next(BANDES(1));
    expect(service.bandes().bandes?.total).toBe(2);
    expect(service.bandes().etat).toBe('pret');
  });

  it('pendant un recalcul, la valeur précédente est GARDÉE (c’est elle qui s’estompe)', () => {
    const { service, etat, bandes } = creer();
    avancer(DELAI_BANDES_MS);
    bandes.appels[0].rep.next(BANDES(7));
    etat.maj({ cible: 'pop_65_plus' });
    TestBed.tick();
    expect(service.bandes()).toMatchObject({ etat: 'chargement', bandes: { total: 7 } });
    expect(service.perime()).toBe(true);
  });

  it('(c) basculer « Lecture des zones » ne relance AUCUN appel', () => {
    const { etat, bandes, courbe, sites, cibles, geo } = creer();
    avancer(DELAI_BANDES_MS);
    const avant = [bandes, courbe, sites, cibles, geo].map((a) => a.appels.length);
    etat.maj({ fusionner: false });
    TestBed.tick();
    avancer(2 * DELAI_BANDES_MS);
    etat.maj({ fusionner: true });
    avancer(2 * DELAI_BANDES_MS);
    expect([bandes, courbe, sites, cibles, geo].map((a) => a.appels.length)).toEqual(avant);
  });

  it('(d) `chemin=departement:13` → un segment résolu, `parent=13`, `region=null`', () => {
    const { service, geo, bandes, courbe, sites } = creer('chemin=departement%3A13');
    // Le référentiel n'a pas répondu : rien ne part, sinon le calcul partirait sur la France entière.
    avancer(DELAI_BANDES_MS);
    expect([bandes.appels.length, courbe.appels.length, sites.appels.length]).toEqual([0, 0, 0]);
    geo.appels[0].rep.next(REF);
    TestBed.tick();
    expect(service.chemin()).toEqual([{ niveau: 'departement', code: '13', nom: 'Bouches-du-Rhône' }]);
    expect(service.dimension()).toBe('departement');
    avancer(DELAI_BANDES_MS);
    expect(bandes.appels).toHaveLength(1);
    expect(bandes.appels[0].args).toMatchObject({ parent: '13', region: null, maille: 'departement' });
    expect(courbe.appels[0].args[1]).toMatchObject({ perimNiveau: 'departement', perimCode: '13' });
    expect(sites.appels[0].args).toMatchObject({ perimNiveau: 'departement', perimCode: '13' });
  });

  it('(d) `region:84` et `departement:84` donnent deux segments DIFFÉRENTS ; la région part dans `region`', () => {
    const r = creer('chemin=region%3A84');
    r.geo.appels[0].rep.next(REF);
    TestBed.tick();
    expect(r.service.chemin()).toEqual([{ niveau: 'region', code: '84', nom: 'Auvergne-Rhône-Alpes' }]);
    avancer(DELAI_BANDES_MS);
    expect(r.bandes.appels[0].args).toMatchObject({ parent: null, region: '84' });
    TestBed.resetTestingModule();
    const d = creer('chemin=departement%3A84');
    d.geo.appels[0].rep.next(REF);
    TestBed.tick();
    expect(d.service.chemin()).toEqual([{ niveau: 'departement', code: '84', nom: 'Vaucluse' }]);
  });

  it('(d) un élément sans préfixe ou inconnu du référentiel est ignoré, jamais une erreur', () => {
    const { service, geo } = creer('chemin=13.region%3A99.commune%3A13055.departement%3A13');
    geo.appels[0].rep.next(REF);
    TestBed.tick();
    expect(service.chemin()).toEqual([{ niveau: 'departement', code: '13', nom: 'Bouches-du-Rhône' }]);
  });

  it('choisirTerritoire et remonter écrivent `etat.chemin` ; la maille naturelle suit', () => {
    const { service, etat, geo } = creer();
    geo.appels[0].rep.next(REF);
    service.choisirTerritoire('departement:13');
    TestBed.tick();
    expect(etat.etat().chemin).toEqual(['departement:13']);
    expect(service.dimension()).toBe('departement');
    service.remonter(0);
    TestBed.tick();
    expect(etat.etat().chemin).toEqual([]);
    expect(service.dimension()).toBe('region');
  });

  it('(e) un 409 `a_construire` → `aConstruire` vrai, message du serveur', () => {
    const { service, bandes } = creer();
    avancer(DELAI_BANDES_MS);
    bandes.appels[0].rep.error(new HttpErrorResponse({
      status: 409, error: { error: 'Le pré-calcul n’est pas construit.', a_construire: true },
    }));
    expect(service.bandes()).toEqual({
      etat: 'echec', bandes: null, aConstruire: true, erreur: 'Le pré-calcul n’est pas construit.',
    });
  });

  it('une panne réseau → message de React, sans `aConstruire`', () => {
    const { service, bandes } = creer();
    avancer(DELAI_BANDES_MS);
    bandes.appels[0].rep.error(new HttpErrorResponse({ status: 0 }));
    expect(service.bandes()).toMatchObject({ etat: 'echec', aConstruire: false, erreur: 'Le calcul des bandes n’a pas répondu.' });
  });

  it('(f) cibles et référentiel : UN appel chacun, quel que soit le nombre de lectures', () => {
    const { service, cibles, geo } = creer();
    cibles.appels[0].rep.next({ cibles: [{ code: 'ind', libelle: 'Population totale', famille: 'Population' }] });
    for (let i = 0; i < 3; i++) {
      service.cibles();
      service.refGeo();
      service.libelleCible();
      TestBed.tick();
    }
    expect(cibles.appels).toHaveLength(1);
    expect(geo.appels).toHaveLength(1);
  });

  it('les contours : un appel par échelle, gardés ensuite', () => {
    const { service, contours } = creer();
    const a = service.contours('region');
    service.contours('region');
    service.contours('departement');
    expect(contours.appels.map((x) => x.args)).toEqual(['region', 'departement']);
    contours.appels[0].rep.next({ type: 'FeatureCollection', features: [{ type: 'Feature' }] });
    expect(a()).toHaveLength(1);
  });

  it('la courbe et les sites ne dépendent pas du profil ; les sites ne dépendent pas de la cible', () => {
    const { etat, courbe, sites } = creer();
    etat.maj({ profil: { ...PROFIL_DEFAUT, haut: [3000] } });
    TestBed.tick();
    expect([courbe.appels.length, sites.appels.length]).toEqual([1, 1]);
    etat.maj({ cible: 'pop_65_plus' });
    TestBed.tick();
    expect([courbe.appels.length, sites.appels.length]).toEqual([2, 1]);
  });

  it('les bandes explorées ne partent que si la requête est non nulle', () => {
    const { service, bandes } = creer();
    avancer(DELAI_BANDES_MS);
    expect(service.bandesExplorees()).toEqual({ etat: 'pret', bandes: null, erreur: null, aConstruire: false });
    service.requeteExploree.set({ profil: 'p', cible: 'ind', maille: 'departement', parent: null, region: '93', natures: [] });
    TestBed.tick();
    avancer(DELAI_BANDES_MS);
    expect(bandes.appels).toHaveLength(2);
    expect(bandes.appels[1].args.region).toBe('93');
  });
});
