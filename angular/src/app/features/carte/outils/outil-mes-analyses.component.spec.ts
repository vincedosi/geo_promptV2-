import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ScoreService } from '../couches/score.service';
import { AnalysesApi } from '../data/analyses.api';
import { ParcoursService } from '../etat/parcours.service';
import { PileEchapService } from '../etat/pile-echap.service';
import { OutilMesAnalysesComponent } from './outil-mes-analyses.component';
import { OutilsCarteService } from './outils-carte.service';

const SCORE = {
  id: '11111111-1111-4111-8111-111111111111', type: 'score', nom: '[ESSAI] Score composite — Bouches-du-Rhône', maillage: 'cp',
  statut: 'termine', created_at: '2026-10-11T08:00:00Z', updated_at: '2026-10-11T08:00:00Z',
};
const CORRELATION = {
  id: '22222222-2222-4222-8222-222222222222', type: 'correlation', nom: '[ESSAI] Corrélation — impressions × Revenu médian', maillage: null,
  statut: 'echec', created_at: '2026-10-10T08:00:00Z', updated_at: '2026-10-10T08:00:00Z',
};
const REJEU = {
  rejeu: {
    type: 'score', nom: `${SCORE.nom} (rejoué)`, maillage: 'cp',
    parametres: { indicateurs: [{ code: 'rev_median', poids: 2, sens: 'croissant' }, { code: 'part_15_29', poids: 1, sens: 'decroissant' }] },
    perimetre: { codes_postaux: ['13001', '13002'], filtre: { type: 'departement', code: '13' }, bbox: null },
  },
  moteur: { cable: true, endpoint: '/api/analyses/score', methode: 'POST' },
};
const SCORES = [{ code: '13001', score: 50, n_indicateurs: 2 }];
const RESULTAT = {
  scores: SCORES,
  indicateurs: [{ code: 'rev_median', label: 'Revenu médian', calcule_le: null }, { code: 'part_15_29', label: 'Part des 15-29 ans', calcule_le: null }],
  perimetre: { n_codes_postaux: 2, n_scores: 1, n_complets: 1 },
};

async function monter(lister: () => unknown = () => of({ analyses: [SCORE, CORRELATION] })) {
  const api = {
    lister: vi.fn(lister),
    rejouer: vi.fn(() => of(REJEU)),
    score: vi.fn(() => of(RESULTAT)),
    supprimer: vi.fn(),
  };
  const score = { afficher: vi.fn(), eteindre: vi.fn() };
  const parcours = { choisir: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), OutilsCarteService, PileEchapService,
      { provide: AnalysesApi, useValue: api },
      { provide: ScoreService, useValue: score },
      { provide: ParcoursService, useValue: parcours },
    ],
  });
  // Le tiroir est créé quand on l'ouvre : l'outil est déjà « analyses » à la création.
  const outils = TestBed.inject(OutilsCarteService);
  outils.ouvrir('analyses');
  const fixture = TestBed.createComponent(OutilMesAnalysesComponent);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, fixture, api, score, parcours, outils };
}

describe('OutilMesAnalysesComponent — le tiroir « Mes analyses » (spec § 6)', () => {
  it('la liste est lue UNE fois, à la création (= première ouverture du tiroir), et rendue par mg-mes-analyses', async () => {
    const { el, api } = await monter();
    expect(api.lister).toHaveBeenCalledTimes(1);
    const lignes = [...el.querySelectorAll('mg-mes-analyses [data-analyse]')].map((l) => l.getAttribute('data-analyse'));
    expect(lignes).toEqual([SCORE.id, CORRELATION.id]);
  });

  it('fermer puis rouvrir ne relit rien ; après un échec, la réouverture relit', async () => {
    let echec = true;
    const { fixture, api, outils, el } = await monter(() => (echec ? throwError(() => new Error('réseau')) : of({ analyses: [SCORE] })));
    expect(api.lister).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-erreur]')).not.toBeNull();
    echec = false;
    outils.fermer();
    await fixture.whenStable();
    expect(api.lister).toHaveBeenCalledTimes(1);
    outils.ouvrir('analyses');
    await fixture.whenStable();
    expect(api.lister).toHaveBeenCalledTimes(2);
    outils.ouvrir('fond');
    await fixture.whenStable();
    outils.ouvrir('analyses');
    await fixture.whenStable();
    expect(api.lister).toHaveBeenCalledTimes(2);
  });

  it('« Rejouer » un score : la carte peint le résultat, et l’étape ③ Analyse s’ouvre (ruling AT-7)', async () => {
    const { el, fixture, api, score, parcours } = await monter();
    expect(parcours.choisir).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>(`[data-analyse="${SCORE.id}"] [data-rejouer]`)!.click();
    await fixture.whenStable();
    expect(api.rejouer).toHaveBeenCalledWith(SCORE.id);
    expect(score.afficher).toHaveBeenCalledWith({ scores: SCORES, libelle: 'Revenu médian × Part des 15-29 ans', nIndicateurs: 2 });
    expect(parcours.choisir).toHaveBeenCalledExactlyOnceWith('analyse');
  });
});
