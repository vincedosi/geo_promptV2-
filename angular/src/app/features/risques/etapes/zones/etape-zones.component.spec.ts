import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ChargementService } from '../../../../core/chargement/chargement.service';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { type JeuDetail, JeuxZonesApi } from '../../data/jeux-zones.api';
import { AtelierJeuxService } from '../../etat/atelier-jeux.service';
import { DonneesRisqueService } from '../../etat/donnees-risque.service';
import { EtatRisqueService } from '../../etat/etat-risque.service';
import { ETAT_DEFAUT, type EtatRisque } from '../../logique/etat-url';
import { PROFIL_DEFAUT } from '../../logique/profil';
import { EtapeZonesComponent, TEXTES_ATELIER } from './etape-zones.component';

interface Appel { nom: string; args: unknown[]; rep: Subject<unknown> }

const DETAIL = (classes: JeuDetail['classes'], brouillon = true, seuil = 20): JeuDetail => ({
  jeu: {
    id: 'brouillon-1', nom: 'Jeu', description: null, version: 1, created_at: '', construit_le: '2026-10-04',
    population_exposee: null, n_cp_retenus: null, taux_utile: null, mode_plan: 'pondere', seuil_couverture_cp: seuil,
    brouillon, profil: {}, profil_hash: 'h', poids: {},
  },
  classes,
});

const vider = () => new Promise((r) => setTimeout(r, 0));

async function rendre(etatInitial: Partial<EtatRisque> = {}, chemin: { niveau: string; code: string; nom: string }[] = []) {
  const appels: Appel[] = [];
  const appeler = (nom: string) => (...args: unknown[]) => {
    const rep = new Subject<unknown>();
    appels.push({ nom, args, rep });
    return new Observable((o) => rep.subscribe(o));
  };
  const etat = signal<EtatRisque>({ ...ETAT_DEFAUT, ...etatInitial });
  TestBed.configureTestingModule({
    providers: [
      ChargementService, AtelierJeuxService,
      { provide: ENREGISTRER_FICHIER, useValue: vi.fn() },
      { provide: JeuxZonesApi, useValue: {
        lister: appeler('lister'), lire: appeler('lire'), construire: appeler('construire'),
        regler: appeler('regler'), supprimer: appeler('supprimer'), exportJeu: appeler('exportJeu'),
        extractions: appeler('extractions'),
      } },
      { provide: EtatRisqueService, useValue: { etat, maj: (p: Partial<EtatRisque>) => etat.update((e) => ({ ...e, ...p })) } },
      { provide: DonneesRisqueService, useValue: {
        profilCalcul: signal(PROFIL_DEFAUT), natures: signal(['Toxiques']), chemin: signal(chemin),
      } },
    ],
  });
  const f = TestBed.createComponent(EtapeZonesComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const dernier = (nom: string) => appels.filter((a) => a.nom === nom).at(-1)!;
  const repondre = async (a: Appel, v: unknown) => { a.rep.next(v); a.rep.complete(); await vider(); await f.whenStable(); };
  return { f, el, etat, appels, dernier, repondre };
}

const kpis = (el: HTMLElement) => [...el.querySelectorAll('mg-kpi [data-role="valeur"]')].map((v) => v.textContent?.replace(/\s+/g, ' ').trim());

describe('EtapeZonesComponent', () => {
  it('vide : le conseil, l’explication et le bouton de construction ; la bibliothèque est lue', async () => {
    const { el, appels } = await rendre();
    expect(el.querySelector('[data-role="conseil"]')?.textContent?.trim()).toBe(TEXTES_ATELIER.conseil);
    expect(el.querySelector('[data-role="vide"]')?.textContent).toContain(TEXTES_ATELIER.boutonConstruire);
    expect(appels.map((a) => a.nom)).toEqual(['lister']);
  });

  it('construire : POST du jeu courant (territoire = DÉPARTEMENT du fil), état en construction, puis KPI', async () => {
    const { f, el, dernier, repondre } = await rendre(
      { gravites: ['seveso_haut'], cible: 'pop_65_plus' },
      [{ niveau: 'region', code: '93', nom: 'PACA' }, { niveau: 'departement', code: '13', nom: 'Bouches-du-Rhône' }],
    );
    el.querySelector<HTMLButtonElement>('[data-role="construire"]')!.click();
    await f.whenStable();
    expect(el.querySelector('[data-role="construction"]')?.textContent?.trim()).toBe(TEXTES_ATELIER.construction);
    expect(dernier('construire').args[0]).toEqual({
      profil: PROFIL_DEFAUT, cible: 'pop_65_plus', gravites: ['seveso_haut'], natures: ['Toxiques'],
      modes: ['buffer', 'pprt'], territoire: '13', mode_plan: 'pondere', seuil_couverture_cp: 20, poids: {},
    });
    await repondre(dernier('construire'), { id: 'brouillon-1' });
    await repondre(dernier('lire'), DETAIL([
      { classe: 'haut:1', n_cp: 100, n_cp_retenus: 60, population_en_zone: 500, population_en_zone_retenue: 400, population_achetee: 600 },
      { classe: 'haut:2', n_cp: 1000, n_cp_retenus: 946, population_en_zone: 50, population_en_zone_retenue: 40.4, population_achetee: 100 },
    ]));
    expect(kpis(el)).toEqual(['440', '62,9 %', '1 006']);
    expect(el.querySelector('mg-kpi[data-role="codes-postaux"]')?.textContent?.replace(/\s+/g, ' ')).toContain('sur 1 100 touchés');
    expect(el.querySelector('[data-role="conseil"]')).toBeNull();
  });

  it('rien d’acheté : taux d’utile « — », jamais 0 %', async () => {
    const { f, el, dernier, repondre } = await rendre();
    el.querySelector<HTMLButtonElement>('[data-role="construire"]')!.click();
    await f.whenStable();
    await repondre(dernier('construire'), { id: 'brouillon-1' });
    await repondre(dernier('lire'), DETAIL([
      { classe: 'haut:1', n_cp: 3, n_cp_retenus: 0, population_en_zone: 10, population_en_zone_retenue: 0, population_achetee: 0 },
    ]));
    expect(kpis(el)).toEqual(['0', '—', '0']);
  });

  it('le curseur de dilution ne règle le jeu QU’AU relâchement (PATCH du seuil), puis relit le détail', async () => {
    const { f, el, appels, dernier, repondre } = await rendre();
    el.querySelector<HTMLButtonElement>('[data-role="construire"]')!.click();
    await f.whenStable();
    await repondre(dernier('construire'), { id: 'brouillon-1' });
    await repondre(dernier('lire'), DETAIL([
      { classe: 'haut:1', n_cp: 3, n_cp_retenus: 2, population_en_zone: 10, population_en_zone_retenue: 8, population_achetee: 9 },
    ]));
    const curseur = el.querySelector<HTMLInputElement>('mg-dilution input[type="range"]')!;
    for (const v of [25, 30, 35]) {
      curseur.value = String(v);
      curseur.dispatchEvent(new Event('input'));
    }
    await f.whenStable();
    expect(appels.filter((a) => a.nom === 'regler')).toHaveLength(0);
    curseur.dispatchEvent(new Event('pointerup'));
    expect(appels.filter((a) => a.nom === 'regler').map((a) => a.args)).toEqual([['brouillon-1', { seuil_couverture_cp: 35 }]]);
    await repondre(dernier('regler'), {});
    expect(dernier('lire').args).toEqual(['brouillon-1']);
  });

  it('« Dupliquer » depuis un jeu de l’URL : l’URL le quitte, et le brouillon construit RESTE affiché', async () => {
    const { f, el, etat, appels, dernier, repondre } = await rendre({ etape: 'zones', jeu: 'enregistre' });
    await repondre(dernier('lire'), { ...DETAIL([], false), jeu: { ...DETAIL([], false).jeu, id: 'enregistre' } });
    el.querySelector<HTMLButtonElement>('[data-role="dupliquer"]')!.click();
    await f.whenStable();
    expect(etat().jeu).toBeNull();
    await repondre(dernier('construire'), { id: 'brouillon-1' });
    await repondre(dernier('lire'), DETAIL([], true));
    await vider();
    await f.whenStable();
    expect(appels.filter((a) => a.nom === 'lire').map((a) => a.args[0])).toEqual(['enregistre', 'brouillon-1']);
    expect(el.querySelector('[data-role="enregistrer"]')).not.toBeNull();
  });

  it('un jeu nommé par l’URL s’ouvre au montage ; le supprimer le retire de l’URL', async () => {
    const { f, el, etat, dernier, repondre } = await rendre({ etape: 'zones', jeu: 'brouillon-1' });
    expect(dernier('lire').args).toEqual(['brouillon-1']);
    await repondre(dernier('lire'), DETAIL([], false));
    await repondre(dernier('lister'), { jeux: [{
      id: 'brouillon-1', nom: 'Jeu', description: null, version: 1, created_at: '', construit_le: null,
      population_exposee: null, n_cp_retenus: 0, taux_utile: null, mode_plan: 'pondere', seuil_couverture_cp: 20,
    }] });
    expect(el.querySelector('mg-tableau-classes [role="status"]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('mg-bibliotheque button[title="Supprimer ce jeu"]')!.click();
    await f.whenStable();
    await repondre(dernier('supprimer'), {});
    await repondre(dernier('lister'), { jeux: [] });
    await vider();
    expect(etat().jeu).toBeNull();
    expect(el.querySelector('[data-role="vide"]')).not.toBeNull();
  });

  it('extractions d’un jeu ENREGISTRÉ : la section les lit, par son identifiant', async () => {
    const { el, appels, dernier, repondre } = await rendre({ etape: 'zones', jeu: 'enregistre' });
    await repondre(dernier('lire'), { ...DETAIL([], false), jeu: { ...DETAIL([], false).jeu, id: 'enregistre' } });
    expect(appels.filter((a) => a.nom === 'extractions').map((a) => a.args)).toEqual([['enregistre']]);
    expect(el.textContent).toContain('Extractions pour le custom bidding');
    expect(el.querySelector('mg-panneau-extractions [data-role="brouillon"]')).toBeNull();
  });

  it('extractions d’un BROUILLON : « enregistrez d’abord », et aucun appel', async () => {
    const { el, appels, dernier, repondre } = await rendre();
    (el.querySelector('[data-role="construire"]') as HTMLButtonElement).click();
    await vider();
    await repondre(dernier('construire'), { id: 'brouillon-1' });
    await repondre(dernier('lire'), DETAIL([], true));
    expect(appels.filter((a) => a.nom === 'extractions')).toHaveLength(0);
    expect(el.querySelector('mg-panneau-extractions [data-role="brouillon"]')).not.toBeNull();
  });
});
