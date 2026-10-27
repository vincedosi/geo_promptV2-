import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PoisService } from '../couches/pois.service';
import { IsochronesApi } from '../data/isochrones.api';
import type { ContexteBataille } from '../logique/bataille/parametres';
import { FILTRE_METROPOLE } from '../logique/perimetre-national';
import { AnnonceService } from './annonce.service';
import { ContexteBatailleService } from './contexte-bataille.service';
import { EtatCarteService } from './etat-carte.service';
import { ReferentielGeoService } from './referentiel-geo.service';

const METRO: ContexteBataille = { categorie: 'cirfa', mode: 'drive', territoire: { ville: '', regions: [], depts: [] }, nbRegionsRef: 18 };
const REGION: ContexteBataille = { ...METRO, territoire: { ville: '', regions: ['93'], depts: [] } };
const SEPT = [10, 20, 30, 40, 50, 60, 90];
/** `formaterNombre` sépare les milliers par une espace fine insécable. */
const espaces = (t: string) => t.replace(/[  ]/g, ' ');
const statut = (total_pois: number) => ({ total_pois, total_combos: total_pois, cached_combos: 0, missing_combos: 0, missing_pois: 0, cached_pois: 0 });

function monter() {
  const caches: Subject<unknown>[] = [];
  const corps: unknown[] = [];
  const api = { verifierCache: (c: unknown) => { corps.push(c); const s = new Subject<unknown>(); caches.push(s); return s; } };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), ContexteBatailleService, EtatCarteService,
      { provide: AnnonceService, useValue: { annoncer: vi.fn() } },
      { provide: IsochronesApi, useValue: api },
      { provide: ReferentielGeoService, useValue: { regions: signal([]) } },
      { provide: PoisService, useValue: { definirZone: vi.fn() } },
    ],
  });
  const etat = TestBed.inject(EtatCarteService);
  etat.filtre.set(FILTRE_METROPOLE);
  return { ctx: TestBed.inject(ContexteBatailleService), etat, caches, corps };
}

describe('ContexteBatailleService — capacité en direct sur la métropole (retours 26/10, T4)', () => {
  it('hors métropole (un territoire) : null, AUCUN appel', () => {
    const { ctx, corps } = monter();
    const vus: (string | null)[] = [];
    ctx.verifierBorne(REGION, SEPT).subscribe((m) => vus.push(m));
    expect(vus).toEqual([null]);
    expect(corps).toEqual([]);
  });

  it('métropole : UNE vérification du cache, premier palier seul ; 95 POI × 7 paliers → null', () => {
    const { ctx, corps, caches } = monter();
    const vus: (string | null)[] = [];
    ctx.verifierBorne(METRO, SEPT).subscribe((m) => vus.push(m));
    expect(corps).toEqual([{ category: 'cirfa', mode: 'drive', paliers: [10], metropolitaine: true,
      filtre_ville: undefined, filtre_regions: undefined, filtre_depts: undefined }]);
    caches[0].next(statut(95));
    expect(vus).toEqual([null]);
  });

  it.each([
    [175, 4, null],
    [175, 7, 'Ce calcul (175 POI × 7 paliers = 1 225 anneaux) dépasse ce qu’on peut calculer en direct.'],
    [500, 1, 'Ce calcul (500 POI ou plus × 1 palier = 500 anneaux ou plus)'],
  ])('métropole, %i POI × %i paliers', (pois, n, attendu) => {
    const { ctx, caches } = monter();
    let vu: string | null | undefined;
    ctx.verifierBorne(METRO, SEPT.slice(0, n)).subscribe((m) => (vu = m));
    caches[0].next(statut(pois));
    if (attendu === null) { expect(vu).toBeNull(); return; }
    expect(espaces(vu!)).toContain(attendu);
    expect(vu).toContain('tâche de fond');
  });

  it('sousBorne : refus noté « > ✕ … », affiché (refusBorne), suite non appelée ; un changement de filtre l’efface', () => {
    const { ctx, etat, caches } = monter();
    const notes: string[] = [];
    const suite = vi.fn();
    ctx.sousBorne(METRO, SEPT, (l) => notes.push(l), suite);
    caches[0].next(statut(175));
    expect(suite).not.toHaveBeenCalled();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^> ✕ Ce calcul \(175 POI × 7 paliers/);
    expect(ctx.refusBorne()).toBe(notes[0].slice(4));
    etat.filtre.set({ type: 'region', code: '93', label: "Provence-Alpes-Côte d'Azur" });
    expect(ctx.refusBorne()).toBeNull();
  });

  it('sousBorne : sous la capacité, suite() ; hors métropole, suite() tout de suite, sans appel', () => {
    const { ctx, caches, corps } = monter();
    const suite = vi.fn();
    ctx.sousBorne(METRO, [10, 20, 30], () => undefined, suite);
    expect(suite).not.toHaveBeenCalled();
    caches[0].next(statut(95));
    expect(suite).toHaveBeenCalledTimes(1);
    ctx.sousBorne(REGION, SEPT, () => undefined, suite);
    expect(suite).toHaveBeenCalledTimes(2);
    expect(corps).toHaveLength(1);
  });

  it('Review Focus 3 : le filtre change pendant le comptage → la réponse tardive ne lance ni ne refuse rien', () => {
    const { ctx, etat, caches } = monter();
    const notes: string[] = [];
    const suite = vi.fn();
    ctx.sousBorne(METRO, SEPT, (l) => notes.push(l), suite);
    etat.filtre.set({ type: 'region', code: '93', label: "Provence-Alpes-Côte d'Azur" });
    caches[0].next(statut(175));
    expect(suite).not.toHaveBeenCalled();
    expect(notes).toEqual([]);
    expect(ctx.refusBorne()).toBeNull();
    // Le lancement suivant compte sur le NOUVEAU filtre : une région, donc aucun comptage, le calcul part.
    ctx.sousBorne(REGION, SEPT, (l) => notes.push(l), suite);
    expect(suite).toHaveBeenCalledTimes(1);
    expect(caches).toHaveLength(1);
    // Une réponse tardive à un comptage dont le filtre a changé, même favorable, ne lance rien.
    etat.filtre.set(FILTRE_METROPOLE);
    ctx.sousBorne(METRO, SEPT, (l) => notes.push(l), suite);
    etat.filtre.set(null);
    caches[1].next(statut(95));
    expect(suite).toHaveBeenCalledTimes(1);
    expect(notes).toEqual([]);
  });

  it('échec du comptage : noté, rien ne part', () => {
    const { ctx, caches } = monter();
    const notes: string[] = [];
    const suite = vi.fn();
    ctx.sousBorne(METRO, SEPT, (l) => notes.push(l), suite);
    caches[0].error(new Error('réseau'));
    expect(suite).not.toHaveBeenCalled();
    expect(notes[0]).toMatch(/^> ✕ Erreur vérif\. cache/);
  });
});
