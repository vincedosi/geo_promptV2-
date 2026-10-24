import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { J1, REGISTRE, Z1, fournisseursJeu } from '../../testing/jeu-factice';
import { EnregistrerJeuComponent } from './enregistrer-jeu.component';

/** Le banc (`testing/jeu-factice.ts`) : navigation vers `url`, puis le composant, l'état de ⑤ à l'injecteur du banc. */
async function monterJeu<T>(composant: Type<T>, url: string, entrees: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ providers: [...fournisseursJeu(), provideHttpClientTesting()] });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(composant);
  for (const [cle, valeur] of Object.entries(entrees)) fixture.componentRef.setInput(cle, valeur);
  const stable = async () => { for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await fixture.whenStable(); } };
  await stable();
  return { fixture, el: fixture.nativeElement as HTMLElement, stable, router, http: TestBed.inject(HttpTestingController), jeu: TestBed.inject(JeuZonesService) };
}

const detail = {
  jeu: { id: J1, type: 'zone', nom: 'Lycées BdR', description: null, version: 1, created_at: '2026-10-24', custom_geo_zone_id: Z1, cible: 'ind', mode_plan: 'pondere' },
  zone: { id: Z1, nom: 'Lycées 5 km', recette: null },
  plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
};

describe('mg-enregistrer-jeu', () => {
  it('« Enregistrer le jeu » : UN POST (nom proposé, zone, cible, mode, choix) ; un double clic n’en lance pas deux ; URL réécrite', async () => {
    const { el, http, router, stable } = await monterJeu(EnregistrerJeuComponent, `/carte?zoneJeu=${Z1}&mailles=dv360.cp.30`, { nomPropose: 'Lycées 5 km' });
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
    expect(bouton.textContent?.trim()).toBe('Enregistrer les réglages');
    expect(el.querySelector('[data-message]')?.textContent?.trim()).toBe('Jeu enregistré.');
  });

  it('jeu ouvert : « Enregistrer les réglages » → PATCH ; un refus (409) se lit tel que la route le dit', async () => {
    const { el, http, stable } = await monterJeu(EnregistrerJeuComponent, `/carte?jeu=${J1}`);
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
