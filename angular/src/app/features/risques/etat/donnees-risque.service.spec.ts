import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { type Bandes, ProfilRisqueApi, type RequeteBandes } from '../data/profil-risque.api';
import { ReferentielApi, type ReponseRefGeo } from '../data/referentiel.api';
import { SitesRisqueApi } from '../data/sites-risque.api';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { PROFIL_DEFAUT } from '../logique/profil';
import { DELAI_BANDES_MS } from '../logique/donnees-risque';
import { DonneesRisqueService } from './donnees-risque.service';
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
  const parametres = convertToParamMap(brut === undefined ? {} : { [PARAM_RISQUE]: brut });
  const route = { snapshot: { queryParamMap: parametres }, queryParamMap: of(parametres) };
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

  it('(b) courbe : deux périmètres, réponses en ordre INVERSE → l’écran garde le DERNIER réglage', () => {
    const { service, geo, courbe } = creer();
    geo.appels[0].rep.next(REF);
    service.choisirTerritoire('departement:13');
    TestBed.tick();
    const premier = courbe.appels[1];
    service.choisirTerritoire('departement:84');
    TestBed.tick();
    // Le second périmètre annule TOUT DE SUITE la lecture du premier.
    expect(premier.annule).toBe(true);
    const second = courbe.appels[2];
    expect(second.args[1]).toMatchObject({ perimNiveau: 'departement', perimCode: '84' });
    second.rep.next({ rayon_max_m: 10000, n_sites: 84, n_departements: 1, courbes: [] });
    premier.rep.next({ rayon_max_m: 10000, n_sites: 13, n_departements: 1, courbes: [] });
    expect(service.courbe().data?.n_sites).toBe(84);
    expect(service.courbe().chargement).toBe(false);
  });

  it('(b) sites : deux périmètres, réponses en ordre INVERSE → l’écran garde le DERNIER réglage', () => {
    const { service, geo, sites } = creer();
    geo.appels[0].rep.next(REF);
    service.choisirTerritoire('departement:13');
    TestBed.tick();
    const premier = sites.appels[1];
    service.choisirTerritoire('departement:84');
    TestBed.tick();
    expect(premier.annule).toBe(true);
    const second = sites.appels[2];
    expect(second.args).toMatchObject({ perimNiveau: 'departement', perimCode: '84' });
    second.rep.next({ n: 84, total: 100 });
    premier.rep.next({ n: 13, total: 100 });
    expect(service.compteSites().compte).toEqual({ n: 84, total: 100 });
    expect(service.compteSites().chargement).toBe(false);
  });

  it('un chemin ENTIÈREMENT mal formé n’attend pas le référentiel : les calculs partent tout de suite', () => {
    const { geo, bandes, courbe, sites } = creer('chemin=13.commune%3A13055');
    expect([courbe.appels.length, sites.appels.length]).toEqual([1, 1]);
    avancer(DELAI_BANDES_MS);
    expect(bandes.appels).toHaveLength(1);
    expect(bandes.appels[0].args).toMatchObject({ parent: null, region: null, maille: 'region' });
    expect(geo.appels).toHaveLength(1); // toujours chargé, pour les menus
  });

  it('un élément BIEN FORMÉ parmi des illisibles fait attendre le référentiel', () => {
    const { geo, courbe } = creer('chemin=13.departement%3A13');
    expect(courbe.appels).toHaveLength(0);
    geo.appels[0].rep.next(REF);
    TestBed.tick();
    expect(courbe.appels).toHaveLength(1);
  });

  it('référentiel en échec : un code bien formé mais inconnu part TEL QUEL, le serveur le valide', () => {
    const { service, geo, courbe } = creer('chemin=region%3A99');
    geo.appels[0].rep.error(new HttpErrorResponse({ status: 500 }));
    TestBed.tick();
    expect(service.chemin()).toEqual([{ niveau: 'region', code: '99', nom: '99' }]);
    expect(courbe.appels[0].args[1]).toMatchObject({ perimNiveau: 'region', perimCode: '99' });
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

  it('les contours : un échec n’est PAS gardé — « indisponible », puis un nouvel appel au changement de maille', () => {
    const { service, contours } = creer();
    const a = service.contours('region');
    contours.appels[0].rep.error(new Error('500'));
    expect(a()).toBe('indisponible');
    // Retour sur la même échelle (après un changement de maille) : l'échec a été évincé, on redemande.
    const b = service.contours('region');
    expect(contours.appels).toHaveLength(2);
    contours.appels[1].rep.next({ type: 'FeatureCollection', features: [{ type: 'Feature' }] });
    expect(b()).toHaveLength(1);
    service.contours('region');
    expect(contours.appels).toHaveLength(2);
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

  // ── L'exploration locale de ③ (T11) ───────────────────────────────────
  describe('exploration de ③', () => {
    const PROFIL = 'h1000.2000.5000_b500.1000_a_L0_P1';

    /** Un écran ouvert, référentiel chargé, bandes globales répondues (total 7). */
    function ouvert(brut?: string) {
      const c = creer(brut);
      c.geo.appels[0].rep.next(REF);
      TestBed.tick();
      avancer(DELAI_BANDES_MS);
      c.bandes.appels[0].rep.next(BANDES(7));
      return c;
    }

    it('hors exploration : requête nulle, AUCUN second appel, le tableau lit le calcul global', () => {
      const { service, bandes } = ouvert();
      avancer(5 * DELAI_BANDES_MS);
      expect(service.requeteExploree()).toBeNull();
      expect(bandes.appels).toHaveLength(1);
      expect(service.bandesExplorees()).toEqual({ etat: 'pret', bandes: null, erreur: null, aConstruire: false });
      expect(service.bandesTableau()).toBe(service.bandes());
      expect(service.mailleTableau()).toBe('region');
    });

    it('descendre dans 93 : requête { departement, region 93, parent null }, URL et calcul global INCHANGÉS', () => {
      const { service, bandes } = ouvert();
      const router = TestBed.inject(Router) as unknown as { navigate: ReturnType<typeof vi.fn> };
      const navigations = router.navigate.mock.calls.length;
      const global = service.bandes();
      service.descendreExploration('93', 'Provence-Alpes-Côte d’Azur');
      TestBed.tick();
      expect(service.requeteExploree()).toEqual({
        profil: PROFIL, cible: 'ind', maille: 'departement', parent: null, region: '93', natures: [],
      });
      expect(service.mailleTableau()).toBe('departement');
      // Le filtre Territoire n'a pas bougé : ni l'état, ni l'URL, ni le bandeau KPI.
      expect(router.navigate.mock.calls.length).toBe(navigations);
      expect(service.chemin()).toEqual([]);
      expect(service.dimension()).toBe('region');
      avancer(DELAI_BANDES_MS);
      expect(bandes.appels).toHaveLength(2);
      expect(bandes.appels[1].args).toEqual(service.requeteExploree());
      bandes.appels[1].rep.next(BANDES(3));
      expect(service.bandes()).toBe(global);
      expect(service.bandes().bandes?.total).toBe(7);
      expect(service.bandesTableau().bandes?.total).toBe(3);
    });

    it('descendre deux fois : commune du département, la région n’est plus envoyée', () => {
      const { service } = ouvert();
      service.descendreExploration('93', 'PACA');
      service.descendreExploration('13', 'Bouches-du-Rhône');
      expect(service.requeteExploree()).toMatchObject({ maille: 'commune', parent: '13', region: null });
      // Dernier niveau : la flèche droite ne fait plus rien.
      service.descendreExploration('13055', 'Marseille');
      expect(service.exploration()).toHaveLength(2);
    });

    it('remonter jusqu’à la racine : requête nulle, ZÉRO appel, le tableau relit le global', () => {
      const { service, bandes } = ouvert();
      service.descendreExploration('93', 'PACA');
      TestBed.tick();
      avancer(DELAI_BANDES_MS);
      expect(bandes.appels).toHaveLength(2);
      service.remonterExploration();
      TestBed.tick();
      avancer(5 * DELAI_BANDES_MS);
      expect(service.requeteExploree()).toBeNull();
      expect(bandes.appels).toHaveLength(2);
      expect(bandes.appels[1].annule).toBe(true);
      expect(service.bandesTableau()).toBe(service.bandes());
    });

    it('l’exploration PART du filtre Territoire, sans l’écrire', () => {
      const { service, bandes } = ouvert('chemin=region%3A93');
      expect(service.mailleTableau()).toBe('departement');
      service.descendreExploration('13', 'Bouches-du-Rhône');
      expect(service.requeteExploree()).toMatchObject({ maille: 'commune', parent: '13', region: null });
      expect(service.chemin()).toEqual([{ niveau: 'region', code: '93', nom: 'Provence-Alpes-Côte d’Azur' }]);
      expect(bandes.appels[0].args).toMatchObject({ maille: 'departement', region: '93', parent: null });
    });

    it('survol et sélection effacés à chaque changement de niveau — exploration OU filtre Territoire', () => {
      const { service } = ouvert();
      const poser = () => { service.survoler('93'); service.selectionner('93'); };
      const effaces = () => [service.actif(), service.selectionCarte()];

      poser();
      expect(effaces()).toEqual(['93', '93']);
      service.descendreExploration('93', 'PACA');
      expect(effaces()).toEqual([null, null]);
      poser();
      service.remonterExploration();
      expect(effaces()).toEqual([null, null]);
      poser();
      service.descendreExploration('93', 'PACA');
      poser();
      service.quitterExploration();
      expect(effaces()).toEqual([null, null]);
      expect(service.exploration()).toEqual([]);
      // Le menu Territoire et le fil d'Ariane de l'en-tête : `93` y désignerait la Seine-Saint-Denis.
      poser();
      service.choisirTerritoire('region:93');
      expect(effaces()).toEqual([null, null]);
      poser();
      service.remonter(0);
      expect(effaces()).toEqual([null, null]);
    });

    it('défaut React corrigé : changer de territoire (menu ou fil) REPART du nouveau territoire, sans exploration', () => {
      const { service, bandes } = ouvert();
      service.descendreExploration('93', 'PACA');
      TestBed.tick();
      avancer(DELAI_BANDES_MS);
      expect(bandes.appels).toHaveLength(2);
      service.choisirTerritoire('departement:13');
      TestBed.tick();
      expect(service.exploration()).toEqual([]);
      expect(service.requeteExploree()).toBeNull();
      expect(service.bandesTableau()).toBe(service.bandes());
      service.descendreExploration('13', 'Bouches-du-Rhône');
      expect(service.exploration()).toHaveLength(1);
      service.remonter(0);
      expect(service.exploration()).toEqual([]);
    });

    it('sélectionner une ligne ne descend pas et n’écrit rien', () => {
      const { service, bandes } = ouvert();
      service.selectionner('84');
      TestBed.tick();
      avancer(5 * DELAI_BANDES_MS);
      expect(service.exploration()).toEqual([]);
      expect(service.requeteExploree()).toBeNull();
      expect(bandes.appels).toHaveLength(1);
      expect(service.chemin()).toEqual([]);
    });
  });
});
