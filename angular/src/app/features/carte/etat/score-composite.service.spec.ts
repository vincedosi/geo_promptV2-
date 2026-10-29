import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ScoreService } from '../couches/score.service';
import { AnalysesApi } from '../data/analyses.api';
import type { Recette } from '../logique/zones/recette';
import { CatalogueIndicateursService } from './catalogue-indicateurs.service';
import { CreationZoneService } from './creation-zone.service';
import { EtatCarteService } from './etat-carte.service';
import { ZoneAnalyseeService } from './zone-analysee.service';
import { ScoreCompositeService } from './score-composite.service';

/** « Créer la zone » du score composite (lot 3) : la zone s'écrit avec la recette figée `capture` de source `score`. */
describe('ScoreCompositeService — « Créer la zone »', () => {
  it('passe par CreationZoneService avec la recette { v: 1, type: capture, source_type: score } et le nom du score', () => {
    const zoneDepuisScore = vi.fn(() => of({ geometry: { type: 'MultiPolygon', coordinates: [] }, count: 3 }));
    const score = vi.fn(() => of({
      scores: [{ code: '13001', score: 80 }], indicateurs: [], perimetre: { n_codes_postaux: 1, n_scores: 1, n_complets: 1 },
    }));
    const creer = vi.fn((source: { subscribe: unknown }, nom: (g: unknown) => string, recette: (g: unknown) => Recette) => {
      void source;
      return of({ geo: { count: 3, nom: nom({}), recette: recette({}) }, countCp: 3 });
    });
    TestBed.configureTestingModule({
      providers: [
        ScoreCompositeService,
        { provide: AnalysesApi, useValue: { zoneDepuisScore, score } },
        { provide: EtatCarteService, useValue: { filtre: signal({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' }) } },
        { provide: ScoreService, useValue: { afficher: vi.fn(), eteindre: vi.fn() } },
        { provide: CatalogueIndicateursService, useValue: { charger: () => of([]) } },
        { provide: CreationZoneService, useValue: { org: signal('org-1'), creer } },
        { provide: ZoneAnalyseeService, useValue: { zoneId: signal(null) } },
      ],
    });
    const s = TestBed.inject(ScoreCompositeService);
    s.choisis.set([{ code: 'taux_pauvrete', label: 'Taux de pauvreté', poids: 1, sens: 'croissant' } as never]);
    s.lancer();
    s.creerZone();
    expect(creer).toHaveBeenCalledTimes(1);
    const [, nom, recette] = creer.mock.calls[0];
    // ③ finitions (T5, V-6) : la zone garde sa provenance — indicateurs, poids, sens, maille, seuil — sans se rejouer.
    expect(recette({})).toEqual({
      v: 1, type: 'capture', source_type: 'score',
      parametres: { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' }], maille: 'cp', seuil_score: 70 },
    });
    expect(nom({})).toContain('Score ≥ 70');
    expect(s.messageZone()).toBe('Zone créée — 3 codes postaux.');
    expect(s.creationZone()).toBe(false);
  });
});

/** Lot 4, T10 : le score s'applique à la zone analysée de ④, et ne survit pas à un changement de zone. */
describe('ScoreCompositeService — sur la zone analysée', () => {
  function monter() {
    const score = vi.fn((_corps: unknown) => of({ scores: [], indicateurs: [], perimetre: { n_codes_postaux: 0, n_scores: 0, n_complets: 0 } }));
    const carte = { afficher: vi.fn(), eteindre: vi.fn() };
    const zoneId = signal<string | null>(null);
    const filtre = signal<unknown>({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    TestBed.configureTestingModule({
      providers: [
        ScoreCompositeService,
        { provide: AnalysesApi, useValue: { score } },
        { provide: EtatCarteService, useValue: { filtre } },
        { provide: ScoreService, useValue: carte },
        { provide: CatalogueIndicateursService, useValue: { charger: () => of([]) } },
        { provide: CreationZoneService, useValue: { org: signal('org-1') } },
        { provide: ZoneAnalyseeService, useValue: { zoneId } },
      ],
    });
    const s = TestBed.inject(ScoreCompositeService);
    s.choisis.set([{ code: 'rev_median', label: 'Revenu médian', poids: 1, sens: 'croissant' }]);
    return { s, score, carte, zoneId, filtre };
  }

  it('sans zone analysée : le périmètre de ① ; avec : la zone par défaut, et la bascule rend ①', () => {
    const { s, score, zoneId } = monter();
    expect(s.zoneScore()).toBeNull();
    zoneId.set('z-1');
    expect(s.zoneScore()).toBe('z-1');
    s.lancer();
    expect(score.mock.calls[0][0]).toMatchObject({ perimetre: { type: 'zone', code: 'z-1' } });
    s.surZone.set(false);
    expect(s.zoneScore()).toBeNull();
    s.lancer();
    expect(score.mock.calls[1][0]).toMatchObject({ perimetre: { type: 'departement', code: '13' } });
  });

  it('une zone suffit : pas de filtre de ①, le score part quand même', () => {
    const { s, score, zoneId, filtre } = monter();
    filtre.set(null);
    s.lancer();
    expect(score).not.toHaveBeenCalled();
    zoneId.set('z-1');
    s.lancer();
    expect(score).toHaveBeenCalledTimes(1);
  });

  it('changer de zone (ou de périmètre) retire le résultat et éteint la carte ; une zone inchangée n’y touche pas', () => {
    const { s, carte, zoneId } = monter();
    zoneId.set('z-1');
    TestBed.tick();
    s.lancer();
    expect(s.resultat()).not.toBeNull();
    carte.eteindre.mockClear();
    TestBed.tick();
    expect(s.resultat()).not.toBeNull();
    zoneId.set('z-2');
    TestBed.tick();
    expect(s.resultat()).toBeNull();
    expect(carte.eteindre).toHaveBeenCalledTimes(1);
  });

  it('fermer le panneau (service détruit) pendant un calcul l’annule : la réponse ne peint pas la carte (ruling T12)', () => {
    const reponse = new Subject<never>();
    const { s, carte } = monter();
    TestBed.inject(AnalysesApi).score = () => reponse as never;
    s.lancer();
    expect(reponse.observed).toBe(true);
    TestBed.resetTestingModule();
    expect(reponse.observed).toBe(false);
    expect(carte.afficher).not.toHaveBeenCalled();
  });

  it('P-c : le calcul en vol d’une zone quittée est annulé, sa réponse n’atteint ni l’écran ni la carte', () => {
    const reponse = new Subject<never>();
    const { s, carte, zoneId } = monter();
    TestBed.inject(AnalysesApi).score = () => reponse as never;
    zoneId.set('z-1');
    TestBed.tick();
    s.lancer();
    expect(s.calcul()).toBe(true);
    zoneId.set('z-2');
    TestBed.tick();
    expect(s.calcul()).toBe(false);
    expect(reponse.observed).toBe(false);
    expect(carte.afficher).not.toHaveBeenCalled();
  });
});
