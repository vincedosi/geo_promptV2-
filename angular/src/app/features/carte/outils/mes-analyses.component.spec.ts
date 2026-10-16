import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ScoreService } from '../couches/score.service';
import { AnalysesApi } from '../data/analyses.api';
import { ParcoursService } from '../etat/parcours.service';
import { MesAnalysesComponent } from './mes-analyses.component';
import { MesAnalysesService } from './mes-analyses.service';

const SCORE = {
  id: '11111111-1111-4111-8111-111111111111', type: 'score', nom: '[ESSAI] Score composite — Bouches-du-Rhône', maillage: 'cp',
  statut: 'termine', created_at: '2026-10-11T08:00:00Z', updated_at: '2026-10-11T08:00:00Z',
};
const CORRELATION = {
  id: '22222222-2222-4222-8222-222222222222', type: 'correlation', nom: '[ESSAI] Corrélation — impressions × Revenu médian', maillage: null,
  statut: 'echec', created_at: '2026-10-10T08:00:00Z', updated_at: '2026-10-10T08:00:00Z',
};

async function monter() {
  const score = { afficher: vi.fn(), eteindre: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), AnalysesApi, MesAnalysesService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: ScoreService, useValue: score },
      { provide: ParcoursService, useValue: { choisir: vi.fn() } },
    ],
  });
  const service = TestBed.inject(MesAnalysesService);
  const fixture = TestBed.createComponent(MesAnalysesComponent);
  const el = fixture.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const rendre = () => fixture.whenStable();
  const ligne = (id: string) => el.querySelector<HTMLElement>(`[data-analyse="${id}"]`)!;
  const charger = async (analyses: unknown[] = [SCORE, CORRELATION]) => {
    service.demanderChargement();
    http.expectOne((r) => r.url.endsWith('/api/analyses') && r.method === 'GET').flush({ analyses });
    await rendre();
  };
  return { el, http, score, service, rendre, ligne, charger };
}

describe('Mes analyses (PanneauCalques.tsx:641-711, use-analyses.ts ; boîte à outils depuis le 2026-10-13)', () => {
  it('un seul chargement : un second appel ne relit rien', async () => {
    const m = await monter();
    await m.charger();
    m.service.demanderChargement();
    m.http.verify();
  });

  it('chaque ligne : nom, date · maillage · statut, badge du type ; « Rejouer » sur un score seulement', async () => {
    const m = await monter();
    await m.charger();
    const s = m.ligne(SCORE.id);
    expect(s.querySelector('[data-nom]')!.textContent!.trim()).toBe('[ESSAI] Score composite — Bouches-du-Rhône');
    expect(s.querySelector('[data-meta]')!.textContent!.trim()).toBe('11/10/2026 · cp');
    expect(s.querySelector('[data-type]')!.textContent!.trim()).toBe('score');
    expect(s.querySelector('[data-rejouer]')).not.toBeNull();
    const c = m.ligne(CORRELATION.id);
    expect(c.querySelector('[data-meta]')!.textContent!.trim()).toBe('10/10/2026 · échec');
    expect(c.querySelector('[data-rejouer]')).toBeNull();
  });

  it('vide : « Aucune analyse enregistrée »', async () => {
    const m = await monter();
    await m.charger([]);
    expect(m.el.textContent).toContain('Aucune analyse enregistrée');
  });

  it('en échec : le message, et un nouveau dépliage relit', async () => {
    const n = await monter();
    n.service.demanderChargement();
    n.http.expectOne((r) => r.url.endsWith('/api/analyses')).flush({}, { status: 500, statusText: 'Erreur' });
    await n.rendre();
    expect(n.el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('Impossible de charger les analyses enregistrées.');
    n.service.demanderChargement();
    n.http.expectOne((r) => r.url.endsWith('/api/analyses'));
  });

  it('« Rejouer » un score : la route de rejeu, puis POST /api/analyses/score avec les paramètres RENDUS ; la carte peint', async () => {
    const m = await monter();
    await m.charger();
    m.ligne(SCORE.id).querySelector<HTMLButtonElement>('[data-rejouer]')!.click();
    await m.rendre();
    const rejeu = m.http.expectOne((r) => r.url.endsWith(`/api/analyses/${SCORE.id}/rejouer`));
    expect(rejeu.request.method).toBe('POST');
    rejeu.flush({
      rejeu: {
        type: 'score', nom: `${SCORE.nom} (rejoué)`, maillage: 'cp',
        parametres: { indicateurs: [{ code: 'rev_median', poids: 2, sens: 'croissant' }, { code: 'part_15_29', poids: 1, sens: 'decroissant' }] },
        perimetre: { codes_postaux: ['13001', '13002'], filtre: { type: 'departement', code: '13' }, bbox: null },
      },
      moteur: { cable: true, endpoint: '/api/analyses/score', methode: 'POST' },
    });
    const calcul = m.http.expectOne((r) => r.url.endsWith('/api/analyses/score'));
    expect(calcul.request.body).toEqual({
      indicateurs: [{ code: 'rev_median', poids: 2, sens: 'croissant' }, { code: 'part_15_29', poids: 1, sens: 'decroissant' }],
      codes_postaux: ['13001', '13002'],
      enregistrer: false,
      nom: `${SCORE.nom} (rejoué)`,
    });
    const scores = [{ code: '13001', score: 50, n_indicateurs: 2 }];
    calcul.flush({
      scores,
      indicateurs: [{ code: 'rev_median', label: 'Revenu médian', calcule_le: null }, { code: 'part_15_29', label: 'Part des 15-29 ans', calcule_le: null }],
      perimetre: { n_codes_postaux: 2, n_scores: 1, n_complets: 1 },
    });
    await m.rendre();
    expect(m.score.afficher).toHaveBeenCalledWith({ scores, libelle: 'Revenu médian × Part des 15-29 ans', nIndicateurs: 2 });
    m.http.verify();
  });

  it('« Supprimer » demande confirmation, puis DELETE et retire la ligne ; « Annuler » ne supprime rien', async () => {
    const m = await monter();
    await m.charger();
    const bouton = (id: string, sel: string) => m.ligne(id).querySelector<HTMLButtonElement>(sel)!;
    bouton(CORRELATION.id, '[data-supprimer]').click();
    await m.rendre();
    bouton(CORRELATION.id, '[data-annuler]').click();
    await m.rendre();
    m.http.verify();
    bouton(CORRELATION.id, '[data-supprimer]').click();
    await m.rendre();
    bouton(CORRELATION.id, '[data-confirmer]').click();
    await m.rendre();
    const req = m.http.expectOne((r) => r.url.endsWith(`/api/analyses/${CORRELATION.id}`));
    expect(req.request.method).toBe('DELETE');
    req.flush({ supprime: 1 });
    await m.rendre();
    expect(m.el.querySelector(`[data-analyse="${CORRELATION.id}"]`)).toBeNull();
    expect(m.el.querySelector(`[data-analyse="${SCORE.id}"]`)).not.toBeNull();
  });

  it('suppression en échec : la ligne reste, avec son message', async () => {
    const m = await monter();
    await m.charger();
    m.ligne(SCORE.id).querySelector<HTMLButtonElement>('[data-supprimer]')!.click();
    await m.rendre();
    m.ligne(SCORE.id).querySelector<HTMLButtonElement>('[data-confirmer]')!.click();
    await m.rendre();
    m.http.expectOne((r) => r.url.endsWith(`/api/analyses/${SCORE.id}`)).flush({ error: 'Erreur base de données.' }, { status: 500, statusText: 'Erreur' });
    await m.rendre();
    expect(m.ligne(SCORE.id).querySelector('[data-message]')!.textContent!.trim()).toBe('Erreur base de données.');
  });
});
