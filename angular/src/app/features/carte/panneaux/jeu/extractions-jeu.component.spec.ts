import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { J1, REGISTRE, Z1, fournisseursJeu } from '../../testing/jeu-factice';
import { ExtractionsJeuComponent, MESSAGE_REPONSE_PERDUE } from './extractions-jeu.component';

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

const detail = {
  jeu: { id: J1, type: 'zone', nom: 'Lycées BdR', description: null, version: 1, created_at: '2026-10-24', custom_geo_zone_id: Z1, cible: 'ind', mode_plan: 'pondere' },
  zone: { id: Z1, nom: 'Lycées 5 km', recette: null },
  plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
};
const LISTE = `/api/zones/jeux/${J1}/extractions`;
const version = (v: number) => ({
  id: `x${v}`, version: v, origine: 'initiale', commentaire: '', seuil_couverture_cp: 20, mode_plan: 'pondere', n_cp: 3, n_retenus: 2,
  taux_utile: 45, part_plan_en_zone: null, created_at: '2026-10-24T10:00:00Z',
  plateformes: [
    { plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null, exacte: false, n_unites: 2, taux_utile: 45 },
    { plateforme: 'ttd', maille: 'polygone', seuil: 20, rayon_m: null, exacte: true, n_unites: 1, taux_utile: 100 },
  ],
});

/** Un jeu ouvert par l'URL, la liste des versions lue. */
async function ouvert(versions = [version(1)]) {
  const o = await monterJeu(ExtractionsJeuComponent, `/carte?jeu=${J1}`);
  o.http.expectOne(`/api/zones/jeux/${J1}`).flush(detail);
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
  await o.stable();
  o.http.expectOne(LISTE).flush({ extractions: versions, jeu: { id: J1, nom: 'Lycées BdR', version: 1 } });
  await o.stable();
  return o;
}
const texte = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

describe('mg-extractions-jeu', () => {
  it('les versions : origine, date et résumé FIGÉ par plateforme ; le lot 6 est annoncé, aucun bouton de fichier', async () => {
    const { el } = await ouvert();
    expect(texte(el, '[data-version="1"] [data-resume]')).toBe('DV360 : codes postaux 2, 45,0 % · The Trade Desk : polygones 1, exacte');
    expect(texte(el, '[data-lot6]')).toBe('Les fichiers par plateforme arrivent avec les exports.');
    expect(el.querySelector('a[download], [data-telecharger]')).toBeNull();
  });

  it('« Extraire » : un POST, puis la liste RELUE ; la version créée est désignée dans ?x=', async () => {
    const { el, http, router, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === LISTE);
    expect(post.request.body).toEqual({ origine: 'initiale', commentaire: '' });
    post.flush({ ok: true, deja_extraite: false, id: 'x2', version: 2 }, { status: 201, statusText: 'Created' });
    await stable();
    http.expectOne(LISTE).flush({ extractions: [version(2), version(1)], jeu: { id: J1, nom: 'Lycées BdR', version: 1 } });
    await stable();
    expect(texte(el, '[data-message]')).toBe('Extraction v2 enregistrée : elle ne bougera plus.');
    expect(router.url).toBe(`/carte?jeu=${J1}&x=2`);
    expect(el.querySelector('[data-version="2"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('`deja_extraite` : « Cette extraction existe déjà (v1). » ; recalage coché part avec l’origine `recalage`', async () => {
    const { el, http, stable } = await ouvert();
    const recalage = el.querySelector<HTMLInputElement>('[data-recalage]')!;
    recalage.click();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    const post = http.expectOne((r) => r.method === 'POST');
    expect(post.request.body).toMatchObject({ origine: 'recalage' });
    post.flush({ ok: true, deja_extraite: true, id: 'x1', version: 1 });
    await stable();
    expect(texte(el, '[data-message]')).toBe('Cette extraction existe déjà (v1).');
  });

  it('réponse PERDUE (statut 0) : ni succès ni échec affirmés — « vérifiez la liste des versions », et la liste est relue', async () => {
    const { el, http, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    http.expectOne((r) => r.method === 'POST').error(new ProgressEvent('error'), { status: 0 });
    await stable();
    expect(texte(el, '[data-erreur]')).toBe(MESSAGE_REPONSE_PERDUE);
    http.expectOne(LISTE);
  });

  it('choisir une version la désigne dans ?x= ; un second clic la retire', async () => {
    const { el, router, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-version="1"]')!.click();
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}&x=1`);
    el.querySelector<HTMLButtonElement>('[data-version="1"]')!.click();
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}`);
  });
});
