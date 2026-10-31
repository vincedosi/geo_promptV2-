import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { J1, REGISTRE, VideJeu, Z1, monterJeu } from '../testing/jeu-factice';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };

/** ⑤ monté sur `url`, le registre lu (l'hôte vide n'injecte pas l'état : il naît à `o.jeu`, ses effets partent au premier `stable`). */
async function monter(url: string) {
  const o = await monterJeu(BANC, VideJeu, url);
  await o.stable();
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
  await o.stable();
  const zone = new URL(url, 'http://h').searchParams.get('zoneJeu');
  if (zone) o.jeu.choisirZone(zone, null); // la recette connue, illisible : les défauts d'un dessin (relecture 2)
  await o.stable();
  return o;
}
const parametre = (url: string, cle: string) => new URL(url, 'http://h').searchParams.get(cle);

describe('JeuZonesService — E4 : le refus `trop_de_cercles` chiffré (⑤ finitions, T5)', () => {
  it('« 481 cercles pour 200 admis par la plateforme : augmentez le rayon ou le seuil. », la phrase de l’avertissement', async () => {
    const { http, jeu, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(
      { error: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.', refus: 'trop_de_cercles', n_cercles: 481, plafond: 200 },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    expect(jeu.erreurs().meta).toBe('481 cercles pour 200 admis par la plateforme : augmentez le rayon ou le seuil.');
  });
  it('sans les chiffres : la phrase du serveur, telle quelle', async () => {
    const { http, jeu, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(
      { error: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.', refus: 'trop_de_cercles' },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    expect(jeu.erreurs().meta).toBe('Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.');
  });
});

describe('JeuZonesService — E6 : la cible et le mode dans l’URL (⑤ finitions, T5, Q-5)', () => {
  it('choisis avant enregistrement : écrits (`?cibleJeu=`, `?modeJeu=`), retirés au retour aux défauts', async () => {
    const { jeu, router, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.choisirCible('jeunes_15_29');
    // ARB-2 (ticket A1) : le défaut d'un jeu de zone est exclusif — c'est pondéré qui s'écrit.
    jeu.choisirMode('pondere');
    await stable();
    expect([parametre(router.url, 'cibleJeu'), parametre(router.url, 'modeJeu')]).toEqual(['jeunes_15_29', 'pondere']);
    jeu.choisirCible('ind');
    jeu.choisirMode('exclusif');
    await stable();
    expect([parametre(router.url, 'cibleJeu'), parametre(router.url, 'modeJeu')]).toEqual([null, null]);
  });
  it('relus au chargement : un lien partagé rouvre ⑤ sur la même cible et le même mode', async () => {
    const { jeu } = await monter(`/carte?zoneJeu=${Z1}&cibleJeu=jeunes_15_29&modeJeu=pondere`);
    expect([jeu.cible(), jeu.modePlan()]).toEqual(['jeunes_15_29', 'pondere']);
  });
  it('illisibles : les défauts, sans lever, et l’URL réécrite sans eux', async () => {
    const { jeu, router } = await monter(`/carte?zoneJeu=${Z1}&cibleJeu=Pas%20une%20cible&modeJeu=zz`);
    expect([jeu.cible(), jeu.modePlan()]).toEqual(['ind', 'exclusif']);
    expect([parametre(router.url, 'cibleJeu'), parametre(router.url, 'modeJeu')]).toEqual([null, null]);
  });
  it('retirés quand `?jeu=` est posé : le jeu enregistré porte sa cible et son mode', async () => {
    const { jeu, router, stable } = await monter(`/carte?zoneJeu=${Z1}&cibleJeu=jeunes_15_29&modeJeu=exclusif`);
    jeu.adopter({
      jeu: {
        id: J1, type: 'zone', nom: 'J', description: null, version: 1, created_at: '', custom_geo_zone_id: Z1, cible: 'jeunes_15_29', mode_plan: 'exclusif',
      },
      zone: { id: Z1, nom: 'Z', recette: null },
      plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
    });
    await stable();
    expect(parametre(router.url, 'jeu')).toBe(J1);
    expect([parametre(router.url, 'cibleJeu'), parametre(router.url, 'modeJeu')]).toEqual([null, null]);
    expect([jeu.cible(), jeu.modePlan()]).toEqual(['jeunes_15_29', 'exclusif']);
  });
});
