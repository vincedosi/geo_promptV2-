import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { DetailJeuZone } from '../data/jeux.api';
import { texteDefaut } from '../logique/jeu/ecran';
import { J1, REGISTRE, VideJeu, Z1, Z2, couvertureCp, monterJeu, urlCouverture, urlSimulationCercles } from '../testing/jeu-factice';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };

/** ⑤ monté sur une zone de l'URL, le registre lu, la recette connue (illisible : les défauts d'un dessin). */
async function monter() {
  const o = await monterJeu(BANC, VideJeu, `/carte?zoneJeu=${Z1}`);
  await o.stable();
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
  await o.stable();
  o.jeu.choisirZone(Z1, null);
  await o.stable();
  return o;
}

const detail = (id: string, categorie: boolean): DetailJeuZone => ({
  jeu: {
    id, type: 'zone', nom: id, description: null, version: 1, created_at: '', custom_geo_zone_id: Z1, cible: 'ind', mode_plan: 'exclusif',
    categorie_speciale: categorie,
  },
  zone: { id: Z1, nom: 'Z', recette: null },
  plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
});

describe('JeuZonesService — revue T6 (I-5) : la case « catégorie spéciale » ne passe ni d’un jeu, ni d’une zone à l’autre', () => {
  it('cochée sur le jeu A (enregistré coché), puis le jeu B ouvert depuis la bibliothèque : B garde SA case, rien de modifié', async () => {
    const { http, jeu, router, stable } = await monter();
    jeu.choisirCategorieSpeciale(true);
    jeu.adopter(detail(J1, true));
    await stable();
    expect(jeu.categorieSpeciale()).toBe(true);
    await router.navigateByUrl(`/carte?jeu=${Z2}`);
    await stable();
    http.expectOne(`/api/zones/jeux/${Z2}`).flush(detail(Z2, false));
    await stable();
    expect(jeu.categorieSpeciale()).toBe(false);
    expect(jeu.modifie()).toBe(false);
  });
  it('cochée avant enregistrement, puis une autre zone choisie : décochée', async () => {
    const { jeu, stable } = await monter();
    jeu.choisirCategorieSpeciale(true);
    jeu.choisirZone(Z2, null);
    await stable();
    expect(jeu.categorieSpeciale()).toBe(false);
  });
  it('jeu fermé (retour à une zone) : la case du jeu ne reste pas', async () => {
    const { jeu, router, stable } = await monter();
    jeu.adopter(detail(J1, false));
    jeu.choisirCategorieSpeciale(true);
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}`);
    await router.navigateByUrl(`/carte?zoneJeu=${Z1}`);
    await stable();
    expect(jeu.jeuId()).toBeNull();
    expect(jeu.categorieSpeciale()).toBe(false);
  });
});

describe('JeuZonesService — revue T6 (I-7) : une simulation en échec s’annonce, le défaut provisoire reste, avec la raison', () => {
  it('429 sur la simulation des cercles de DV360 : défaut provisoire au CP, la raison dite tout de suite, aucune relance', async () => {
    const { http, jeu, stable } = await monter();
    jeu.valider('dv360');
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    http.expectOne(urlSimulationCercles(Z1)).flush({ error: 'Trop de requêtes : réessayez dans 30 s.' }, { status: 429, statusText: 'Too Many' });
    await stable();
    const d = jeu.defauts().dv360!;
    expect(d).toMatchObject({ maille: 'cp', critere: 'en_attente', echecs: [{ maille: 'cercle', transitoire: true }] });
    expect(texteDefaut(d)).toBe('Codes postaux par défaut (export manuel), provisoirement : la simulation en cercles a échoué. '
      + 'Trop de requêtes : réessayez dans 30 s.');
    jeu.valider('dv360');
    expect(http.match((r) => r.url.includes('/cercles'))).toEqual([]);
  });
  it('refus métier (trop de cercles) : la maille sort de la course, et la ligne du défaut dit pourquoi', async () => {
    const { http, jeu, stable } = await monter();
    jeu.valider('dv360');
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    http.expectOne(urlSimulationCercles(Z1)).flush(
      { error: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.', refus: 'trop_de_cercles' },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    const d = jeu.defauts().dv360!;
    expect(d.critere).not.toBe('en_attente');
    expect(d.echecs).toEqual([{ maille: 'cercle', transitoire: false, message: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.' }]);
    expect(texteDefaut(d)).toContain(' Cercles écartés du choix : Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.');
  });
});
