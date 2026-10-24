import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { J1, REGISTRE, Z1, fournisseursJeu } from '../../testing/jeu-factice';
import { BibliothequeJeuxComponent } from './bibliotheque-jeux.component';

/** Le banc (`testing/jeu-factice.ts`) : navigation vers `url`, puis le composant, l'état de ⑤ à l'injecteur du banc. */
async function monterJeu<T>(composant: Type<T>, url: string) {
  TestBed.configureTestingModule({ providers: [...fournisseursJeu(), provideHttpClientTesting()] });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(composant);
  const stable = async () => { for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await fixture.whenStable(); } };
  await stable();
  return { fixture, el: fixture.nativeElement as HTMLElement, stable, router, http: TestBed.inject(HttpTestingController), jeu: TestBed.inject(JeuZonesService) };
}

const RISQUE = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
const ligne = (id: string, type: 'risque' | 'zone', nom: string) => ({
  id, type, nom, description: null, version: 1, created_at: '', construit_le: null, population_exposee: null,
  n_cp_retenus: type === 'risque' ? 12 : null, taux_utile: null, mode_plan: 'pondere', seuil_couverture_cp: 20,
  custom_geo_zone_id: type === 'zone' ? Z1 : null, zone_nom: type === 'zone' ? 'Lycées 5 km' : null,
});
const LISTE = { jeux: [ligne(RISQUE, 'risque', 'Vallée de la chimie'), ligne(J1, 'zone', 'Lycées BdR')] };

async function ouverte(url = '/carte') {
  const o = await monterJeu(BibliothequeJeuxComponent, url);
  o.el.querySelector<HTMLElement>('mg-entete-section')!.click();
  await o.stable();
  o.http.expectOne('/api/zones/jeux').flush(LISTE);
  await o.stable();
  return o;
}

describe('mg-bibliotheque-jeux', () => {
  it('lue à la PREMIÈRE ouverture seulement, une fois ; les deux types, badge neutre', async () => {
    const o = await monterJeu(BibliothequeJeuxComponent, '/carte');
    o.http.verify();
    const entete = o.el.querySelector<HTMLElement>('mg-entete-section')!;
    entete.click();
    await o.stable();
    o.http.expectOne('/api/zones/jeux').flush(LISTE);
    await o.stable();
    entete.click();
    entete.click();
    await o.stable();
    o.http.verify();
    expect([...o.el.querySelectorAll('[data-type-jeu]')].map((b) => b.textContent?.trim())).toEqual(['Risque', 'Zone']);
  });

  it('ouvrir un jeu RISQUE navigue vers le module (`ouvrirJeuDeZones`) ; un jeu de ZONE pose ?jeu=', async () => {
    const { el, router, stable } = await ouverte();
    const naviguer = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>(`[data-jeu-liste="${RISQUE}"] [data-ouvrir-jeu]`)!.click();
    expect(naviguer).toHaveBeenCalledWith(['risques'], expect.objectContaining({ queryParams: { risque: `etape=zones&jeu=${RISQUE}` } }));
    naviguer.mockRestore();
    el.querySelector<HTMLButtonElement>(`[data-jeu-liste="${J1}"] [data-ouvrir-jeu]`)!.click();
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}&etape=jeu`);
  });

  it('supprimer : confirmation, DELETE, la ligne part ; le jeu OUVERT supprimé se ferme, sa zone reste', async () => {
    const { el, http, jeu, stable } = await ouverte(`/carte?jeu=${J1}`);
    http.expectOne(`/api/zones/jeux/${J1}`).flush({
      jeu: { id: J1, type: 'zone', nom: 'Lycées BdR', description: null, version: 1, created_at: '', custom_geo_zone_id: Z1, cible: 'ind', mode_plan: 'pondere' },
      zone: { id: Z1, nom: 'Lycées 5 km', recette: null }, plateformes: [],
    });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    // jsdom n'a pas l'API du <dialog> : la doublure de `clustering-factice.ts`, en ligne.
    const proto = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void };
    proto.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    proto.close ??= function (this: HTMLDialogElement) { this.open = false; };
    el.querySelector<HTMLButtonElement>(`[data-jeu-liste="${J1}"] [data-supprimer-jeu]`)!.click();
    await stable();
    expect(el.querySelector('mg-dialogue-suppression-zone')?.textContent).toContain('Supprimer le jeu de zones');
    el.querySelector<HTMLButtonElement>('[data-confirmer]')!.click();
    await stable();
    http.expectOne((r) => r.method === 'DELETE' && r.url === `/api/zones/jeux/${J1}`).flush({ ok: true, supprimes: 1 });
    await stable();
    expect(el.querySelector(`[data-jeu-liste="${J1}"]`)).toBeNull();
    expect(el.querySelector('mg-dialogue-suppression-zone')).toBeNull();
    expect([jeu.jeuId(), jeu.zoneId()]).toEqual([null, Z1]);
  });
});
