import { HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { ActivationApi } from '../../data/activation.api';
import type { FormatFichier } from '../../logique/activation/cartes';
import { libelleFormat, nomRepliFichier } from '../../logique/activation/fichiers';
import type { Maille, Plateforme } from '../../logique/jeu/plateformes';
import { FichiersExtractionComponent } from './fichiers-extraction.component';

@Component({
  selector: 'mg-hote-fichiers',
  imports: [FichiersExtractionComponent],
  template: `<mg-fichiers-extraction jeuFichier="j1" [versionFichier]="2" [plateformeFichier]="plateforme()" [mailleFichier]="maille()"
                                    [formats]="formats()" [aVerifier]="aVerifier()" [blocsFichier]="blocs()" />`,
})
class Hote {
  readonly plateforme = signal<Plateforme>('dv360');
  readonly maille = signal<Maille>('cp');
  readonly formats = signal<FormatFichier[]>(['cp', 'sdf']);
  readonly aVerifier = signal(false);
  readonly blocs = signal<{ numero: number; n_unites: number }[]>([]);
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

async function rendre(p: Partial<{ plateforme: Plateforme; maille: Maille; formats: FormatFichier[]; aVerifier: boolean; blocs: { numero: number; n_unites: number }[] }> = {}) {
  const api = { fichier: vi.fn(() => of(new HttpResponse({ body: new Blob(['x']), headers: new HttpHeaders() }))) };
  const enregistrer = vi.fn();
  TestBed.configureTestingModule({ providers: [{ provide: ActivationApi, useValue: api }, { provide: ENREGISTRER_FICHIER, useValue: enregistrer }] });
  const f = TestBed.createComponent(Hote);
  if (p.plateforme) f.componentInstance.plateforme.set(p.plateforme);
  if (p.maille) f.componentInstance.maille.set(p.maille);
  if (p.formats) f.componentInstance.formats.set(p.formats);
  if (p.aVerifier) f.componentInstance.aVerifier.set(true);
  if (p.blocs) f.componentInstance.blocs.set(p.blocs);
  f.detectChanges();
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const boutons = () => [...el.querySelectorAll<HTMLButtonElement>('mg-bouton-export button')];
  return { f, el, api, enregistrer, boutons };
}

describe('mg-fichiers-extraction', () => {
  it('DV360 au CP : « Codes postaux » et « SDF DV360 » ; un clic lit le fichier par l’API (Bearer), jamais un <a href>', async () => {
    const { f, el, api, enregistrer, boutons } = await rendre();
    expect(boutons().map((b) => b.textContent!.trim())).toEqual(['Codes postaux', 'SDF DV360']);
    expect(el.querySelector('a[href], a[download]')).toBeNull();
    expect(el.querySelector('mg-fichiers-extraction')!.getAttribute('data-fichiers-extraction')).toBe('dv360');
    boutons()[1].click();
    await f.whenStable();
    expect(api.fichier).toHaveBeenCalledWith('j1', 2, 'dv360', 'sdf');
    expect(enregistrer).toHaveBeenCalledWith(expect.anything(), expect.any(HttpResponse), 'extraction_v2_dv360_sdf.txt');
  });

  it('un libellé par format ; les territoires se disent d’après la maille', () => {
    expect(libelleFormat('cercles', 'cercle')).toBe('Cercles (CSV)');
    expect(libelleFormat('polygone', 'polygone')).toBe('Polygone (GeoJSON)');
    expect(libelleFormat('territoires', 'departement')).toBe('Départements (CSV)');
    expect(libelleFormat('territoires', 'commune')).toBe('Communes (CSV)');
    expect(libelleFormat('cp', 'cp')).toBe('Codes postaux');
    expect([nomRepliFichier(1, 'ttd', 'polygone'), nomRepliFichier(1, 'meta', 'cp'), nomRepliFichier(1, 'dv360', 'cp')])
      .toEqual(['extraction_v1_ttd_polygone.geojson', 'extraction_v1_meta_cp.csv', 'extraction_v1_dv360_cp.txt']);
  });

  it('TikTok au département : « Départements (CSV) » ; « à vérifier » quand la règle l’est', async () => {
    const { el, boutons } = await rendre({ plateforme: 'tiktok', maille: 'departement', formats: ['territoires'], aVerifier: true });
    expect(boutons().map((b) => b.textContent!.trim())).toEqual(['Départements (CSV)']);
    expect(el.querySelector('[data-a-verifier]')!.textContent!.trim()).toBe('à vérifier');
  });

  it('B14 round 1 (I-2) : 3 500 communes en 2 blocs — un fichier par bloc, chacun lu avec son `bloc`', async () => {
    const { f, api, enregistrer, boutons } = await rendre({
      plateforme: 'tiktok', maille: 'commune', formats: ['territoires'], blocs: [{ numero: 1, n_unites: 3000 }, { numero: 2, n_unites: 500 }],
    });
    expect(boutons().map((b) => b.textContent!.trim().replace(/\s/g, ' '))).toEqual(['Communes (CSV) — bloc 1 (3 000)', 'Communes (CSV) — bloc 2 (500)']);
    boutons()[1].click();
    await f.whenStable();
    expect(api.fichier).toHaveBeenCalledWith('j1', 2, 'tiktok', 'territoires', 2);
    expect(enregistrer).toHaveBeenCalledWith(expect.anything(), expect.any(HttpResponse), 'extraction_v2_tiktok_territoires_bloc2.csv');
  });

  it('aucun format (Meta sur un jeu risque, ruling 4) : rien, pas même le badge', async () => {
    const { el, boutons } = await rendre({ plateforme: 'meta', formats: [], aVerifier: true });
    expect(boutons()).toHaveLength(0);
    expect(el.querySelector('[data-a-verifier]')).toBeNull();
  });

  it('un échec affiche le message de la route, et rien n’est enregistré', async () => {
    const { f, el, api, enregistrer, boutons } = await rendre({ plateforme: 'ttd', maille: 'polygone', formats: ['polygone'] });
    const erreur = new HttpErrorResponse({
      status: 409, error: new Blob([JSON.stringify({ error: 'Aucune unité retenue pour cette plateforme.' })], { type: 'application/json' }),
    });
    api.fichier.mockReturnValue(throwError(() => erreur));
    boutons()[0].click();
    for (let i = 0; i < 3; i++) { await attendre(); await f.whenStable(); }
    expect(el.querySelector('[role="alert"]')!.textContent!.trim()).toBe('Aucune unité retenue pour cette plateforme.');
    expect(enregistrer).not.toHaveBeenCalled();
  });
});
