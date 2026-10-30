import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { J1, REGISTRE, Z1, Z2, monterJeu } from '../../testing/jeu-factice';
import { EnregistrerJeuComponent } from './enregistrer-jeu.component';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };

const detail = {
  jeu: { id: J1, type: 'zone', nom: 'Lycées BdR', description: null, version: 1, created_at: '2026-10-24', custom_geo_zone_id: Z1, cible: 'ind', mode_plan: 'pondere' },
  zone: { id: Z1, nom: 'Lycées 5 km', recette: null },
  plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
};

describe('mg-enregistrer-jeu', () => {
  it('« Enregistrer le jeu » : UN POST (nom proposé, zone, cible, mode, choix) ; un double clic n’en lance pas deux ; URL réécrite', async () => {
    const { el, http, router, stable } = await monterJeu(BANC, EnregistrerJeuComponent, `/carte?zoneJeu=${Z1}&mailles=dv360.cp.30`, { entrees: { nomPropose: 'Lycées 5 km' } });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('Lycées 5 km');
    const bouton = el.querySelector<HTMLButtonElement>('[data-enregistrer]')!;
    expect(bouton.textContent?.trim()).toBe('Enregistrer le jeu');
    bouton.click();
    bouton.click();
    await stable();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/zones/jeux');
    expect(post.request.body).toEqual({
      nom: 'Lycées 5 km',
      jeu: {
        type: 'zone', zone_id: Z1, cible: 'ind', mode_plan: 'pondere',
        plateformes: [
          { plateforme: 'dv360', maille: 'cp', seuil: 30 }, { plateforme: 'ttd', maille: 'polygone', seuil: 20 },
          { plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 10000 }, { plateforme: 'tiktok', maille: 'departement', seuil: 20 },
        ],
      },
    });
    post.flush({ id: J1, version: 1 });
    await stable();
    http.verify();
    expect(router.url).toBe(`/carte?jeu=${J1}`);
    // E5 (⑤ finitions, T5) : « Mes zones › Jeux de zones » relira sa liste à son prochain affichage.
    expect(TestBed.inject(OutilsCarteService).revisionJeux()).toBe(1);
    expect(bouton.textContent?.trim()).toBe('Enregistrer les réglages');
    expect(el.querySelector('[data-message]')?.textContent?.trim()).toBe('Jeu enregistré.');
  });

  it('P-c : un POST qui répond après un changement de zone n’est ni adopté ni dit « Jeu enregistré. » (revue finale, point 4)', async () => {
    const { el, http, jeu, stable } = await monterJeu(BANC, EnregistrerJeuComponent, `/carte?zoneJeu=${Z1}`, { entrees: { nomPropose: 'Lycées 5 km' } });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-enregistrer]')!.click();
    await stable();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/zones/jeux');
    jeu.choisirZone(Z2);
    post.flush({ id: J1, version: 1 });
    await stable();
    expect(jeu.jeuId()).toBeNull();
    expect(el.querySelector('[data-message], [data-erreur]')).toBeNull();
  });

  it('jeu ouvert : « Enregistrer les réglages » → PATCH ; un refus (409) se lit tel que la route le dit', async () => {
    const { el, http, stable } = await monterJeu(BANC, EnregistrerJeuComponent, `/carte?jeu=${J1}`);
    http.expectOne(`/api/zones/jeux/${J1}`).flush(detail);
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('Lycées BdR');
    el.querySelector<HTMLButtonElement>('[data-enregistrer]')!.click();
    await stable();
    const patch = http.expectOne((r) => r.method === 'PATCH');
    expect(patch.request.body).toMatchObject({ nom: 'Lycées BdR', mode_plan: 'pondere' });
    patch.flush({ error: 'Ce jeu est rattaché à une campagne.' }, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(el.querySelector('[data-erreur]')?.textContent?.trim()).toBe('Ce jeu est rattaché à une campagne.');
  });
});
