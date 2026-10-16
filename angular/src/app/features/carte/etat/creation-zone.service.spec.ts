import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ZonesApi } from '../data/zones.api';
import { CreationZoneService } from './creation-zone.service';

const GEO = { type: 'MultiPolygon', coordinates: [] } as GeoJSON.MultiPolygon;
const attendre = () => new Promise((r) => setTimeout(r, 0));

async function monter(enregistrer: unknown = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z', count_cp: 7 } })))) {
  TestBed.configureTestingModule({
    providers: [
      CreationZoneService,
      { provide: ZonesApi, useValue: { enregistrer } },
      { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: 'org-1' }) } },
    ],
  });
  const service = TestBed.inject(CreationZoneService);
  await attendre();
  return { service, enregistrer: enregistrer as ReturnType<typeof vi.fn> };
}

describe('CreationZoneService — écrit par POST /api/zones avec la recette (lot 3, L3-6)', () => {
  it('codes postaux, rayon : { nom, recette } — sans géométrie, le serveur rejoue la recette', async () => {
    const { service, enregistrer } = await monter();
    const issue = await firstValueFrom(service.creer(of({ geometry: GEO, n: 2 }), () => 'Deux CP', () => ({ v: 1, type: 'codes_postaux', codes: ['13001', '13002'] })));
    expect(enregistrer).toHaveBeenCalledWith({ nom: 'Deux CP', recette: { v: 1, type: 'codes_postaux', codes: ['13001', '13002'] } });
    expect(issue).toEqual({ geo: { geometry: GEO, n: 2 }, countCp: 7 });
    await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'R', () => ({ v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 1000 })));
    expect(enregistrer).toHaveBeenLastCalledWith({ nom: 'R', recette: { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 1000 } });
  });

  it('dessin et capture (formes figées, P5) : la géométrie de la route source part avec la recette', async () => {
    const { service, enregistrer } = await monter();
    await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'Tracé', () => ({ v: 1, type: 'dessin' })));
    expect(enregistrer).toHaveBeenCalledWith({ nom: 'Tracé', recette: { v: 1, type: 'dessin' }, geometrie: GEO });
    await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'Score', () => ({ v: 1, type: 'capture', source_type: 'score' })));
    expect(enregistrer).toHaveBeenLastCalledWith({ nom: 'Score', recette: { v: 1, type: 'capture', source_type: 'score' }, geometrie: GEO });
  });

  it('nom borné à 200 caractères', async () => {
    const { service, enregistrer } = await monter();
    await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'x'.repeat(250), () => ({ v: 1, type: 'dessin' })));
    expect((enregistrer.mock.calls[0][0] as { nom: string }).nom).toHaveLength(200);
  });

  it('un 207 reste une réussite (la zone existe), jamais renvoyé ; il porte l’avertissement de la route', async () => {
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 207, body: { zone_id: 'z', warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' } })));
    const { service } = await monter(enregistrer);
    const issue = await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'N', () => ({ v: 1, type: 'dessin' })));
    expect(issue).toEqual({ geo: { geometry: GEO }, countCp: undefined, avertissement: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' });
    expect(enregistrer).toHaveBeenCalledTimes(1);
  });

  it('un 207 sans message : l’avertissement de repli', async () => {
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 207, body: { zone_id: 'z', warning: 'codes_non_resolus' } })));
    const { service } = await monter(enregistrer);
    const issue = await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'N', () => ({ v: 1, type: 'dessin' })));
    expect(issue).toMatchObject({ avertissement: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' });
  });

  it('une combinaison est calculée par le serveur : sa géométrie n’est pas envoyée', async () => {
    const { service, enregistrer } = await monter();
    await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'N', () => ({ v: 1, type: 'combinaison', operation: 'union', zones: ['a', 'b'] })));
    expect(enregistrer.mock.calls[0][0]).not.toHaveProperty('geometrie');
  });

  it('écriture en échec → « Sauvegarde de la zone échouée. » ; refus de la source → son message, rien d’écrit', async () => {
    const enregistrer = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    const { service } = await monter(enregistrer);
    expect(await firstValueFrom(service.creer(of({ geometry: GEO }), () => 'N', () => ({ v: 1, type: 'dessin' }))))
      .toEqual({ erreur: 'Sauvegarde de la zone échouée.' });
    enregistrer.mockClear();
    const refus = throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Le centre est en mer.' } }));
    expect(await firstValueFrom(service.creer(refus, () => 'N', () => ({ v: 1, type: 'dessin' })))).toEqual({ erreur: 'Le centre est en mer.' });
    expect(enregistrer).not.toHaveBeenCalled();
  });
});
