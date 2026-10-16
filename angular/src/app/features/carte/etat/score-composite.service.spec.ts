import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ScoreService } from '../couches/score.service';
import { AnalysesApi } from '../data/analyses.api';
import type { Recette } from '../logique/zones/recette';
import { CatalogueIndicateursService } from './catalogue-indicateurs.service';
import { CreationZoneService } from './creation-zone.service';
import { EtatCarteService } from './etat-carte.service';
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
      ],
    });
    const s = TestBed.inject(ScoreCompositeService);
    s.choisis.set([{ code: 'taux_pauvrete', label: 'Taux de pauvreté', poids: 1, sens: 'croissant' } as never]);
    s.lancer();
    s.creerZone();
    expect(creer).toHaveBeenCalledTimes(1);
    const [, nom, recette] = creer.mock.calls[0];
    expect(recette({})).toEqual({ v: 1, type: 'capture', source_type: 'score' });
    expect(nom({})).toContain('Score ≥ 70');
    expect(s.messageZone()).toBe('Zone créée — 3 codes postaux.');
    expect(s.creationZone()).toBe(false);
  });
});
