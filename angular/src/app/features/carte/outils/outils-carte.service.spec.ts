import { TestBed } from '@angular/core/testing';
import { PileEchapService } from '../etat/pile-echap.service';
import { OutilsCarteService, PILE_OUTIL } from './outils-carte.service';

describe('OutilsCarteService — un tiroir à la fois, dans la pile Échap', () => {
  let outils: OutilsCarteService;
  let pile: PileEchapService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [OutilsCarteService, PileEchapService] });
    outils = TestBed.inject(OutilsCarteService);
    pile = TestBed.inject(PileEchapService);
  });

  const ids = () => pile.etat().map((e) => e.id);

  it('basculer(fond) ouvre, re-basculer(fond) ferme, basculer(aide) remplace', () => {
    expect(outils.outil()).toBeNull();
    outils.basculer('fond');
    expect(outils.outil()).toBe('fond');
    outils.basculer('fond');
    expect(outils.outil()).toBeNull();
    outils.basculer('fond');
    outils.basculer('aide');
    expect(outils.outil()).toBe('aide');
    outils.ouvrir('reglages');
    expect(outils.outil()).toBe('reglages');
    outils.fermer();
    expect(outils.outil()).toBeNull();
  });

  it('un outil ouvert est dans la pile : fermerLePlusHaut() le ferme ; fermé, la pile ne contient plus « outil »', () => {
    outils.basculer('aide');
    TestBed.tick();
    expect(ids()).toEqual([PILE_OUTIL]);
    pile.fermerLePlusHaut();
    expect(outils.outil()).toBeNull();
    TestBed.tick();
    expect(ids()).toEqual([]);

    outils.basculer('fond');
    TestBed.tick();
    outils.fermer();
    TestBed.tick();
    expect(ids()).not.toContain(PILE_OUTIL);
  });

  it('remplacer un outil par un autre garde UNE seule entrée « outil »', () => {
    outils.basculer('fond');
    TestBed.tick();
    outils.basculer('aide');
    TestBed.tick();
    expect(ids()).toEqual([PILE_OUTIL]);
  });

  it('les outils ouverts restent « visités » (contenu monté à la première ouverture puis gardé, ruling AT-6)', () => {
    expect([...outils.visites()]).toEqual([]);
    outils.basculer('fond');
    outils.basculer('aide');
    outils.fermer();
    expect([...outils.visites()].sort()).toEqual(['aide', 'fond']);
  });

  it('zonesModifiees() incrémente revisionZones ; la légende est visible par défaut', () => {
    expect(outils.revisionZones()).toBe(0);
    outils.zonesModifiees();
    outils.zonesModifiees();
    expect(outils.revisionZones()).toBe(2);
    expect(outils.legendeVisible()).toBe(true);
  });
});
