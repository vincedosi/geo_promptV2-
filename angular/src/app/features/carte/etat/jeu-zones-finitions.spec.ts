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

describe('JeuZonesService — B10 : rayon tiré de la surface, rayon proposé sous le plafond', () => {
  it('la surface donnée avec la recette règle le rayon par défaut de Meta (20 km² → 1 km ; 30 000 km² → 32,5 km)', async () => {
    const { jeu, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.choisirZone(Z1, null, null, 20);
    await stable();
    expect(jeu.surface()).toBe(20);
    expect(jeu.choix().meta).toMatchObject({ maille: 'cercle', rayon_m: 1000 });
    jeu.choisirZone(Z1, null, null, 30000);
    await stable();
    expect(jeu.choix().meta?.rayon_m).toBe(32500);
  });
  it('le refus porte le plus petit rayon qui passe : dit (avant → après), offert, oublié une fois réglé', async () => {
    const { http, jeu, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(
      { error: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.', refus: 'trop_de_cercles', n_cercles: 481, plafond: 200,
        rayon_propose: { rayon_m: 16000, n_cercles: 196, au_pas: true, essais: 5 } },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    expect(jeu.erreurs().meta).toBe('481 cercles pour 200 admis par la plateforme. Plus petit rayon sous le plafond : 16 km (196 cercles).');
    expect(jeu.rayonsProposes().meta).toEqual({ rayon_m: 16000, n_cercles: 196, au_pas: true });
    jeu.regler('meta', { rayon: 16000 });
    await stable();
    expect(jeu.choix().meta?.rayon_m).toBe(16000);
    expect(jeu.rayonsProposes().meta).toBeUndefined();
  });
  it('aucun rayon jusqu’au maximum : la phrase le dit, rien n’est offert', async () => {
    const { http, jeu, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(
      { error: 'x', refus: 'trop_de_cercles', n_cercles: 900, plafond: 200, rayon_propose: null,
        sans_proposition: { motif: 'aucun_sous_plafond', rayon_max_m: 80000, essais: 1 } },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    expect(jeu.erreurs().meta).toBe('900 cercles pour 200 admis par la plateforme, et encore trop jusqu’au rayon maximal (80 km) : relevez le seuil ou réduisez la zone.');
    expect(jeu.rayonsProposes().meta).toBeUndefined();
  });
  it('tour 1 (I-1) : recherche interrompue (quota) — le meilleur connu et le dernier rayon essayé, dits', async () => {
    const { http, jeu, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(
      { error: 'x', refus: 'trop_de_cercles', n_cercles: 481, plafond: 200,
        rayon_propose: { rayon_m: 17500, n_cercles: 164, au_pas: false, essais: 2 },
        interrompue: { cause: 'quota', dernier_rayon_m: 11500, dernier_n_cercles: 379 } },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    expect(jeu.erreurs().meta).toBe('481 cercles pour 200 admis par la plateforme. Rayon sous le plafond : 17,5 km (164 cercles) ; '
      + 'recherche interrompue (quota de calculs atteint, réessayez dans une minute) : dernier rayon essayé 11,5 km (379 cercles).');
    expect(jeu.rayonsProposes().meta?.rayon_m).toBe(17500);
  });
  it('tour 1 (I-1) : interrompue (temps) sans rayon admis : la phrase le dit, rien n’est offert', async () => {
    const { http, jeu, stable } = await monter(`/carte?zoneJeu=${Z1}`);
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(
      { error: 'x', refus: 'trop_de_cercles', n_cercles: 900, plafond: 200, rayon_propose: null,
        sans_proposition: { motif: 'interrompue', rayon_max_m: 80000, essais: 3 },
        interrompue: { cause: 'temps', dernier_rayon_m: 40000, dernier_n_cercles: 260 } },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    expect(jeu.erreurs().meta).toBe('900 cercles pour 200 admis par la plateforme. Recherche interrompue (temps de calcul épuisé) : '
      + 'dernier rayon essayé 40 km (260 cercles).');
    expect(jeu.rayonsProposes().meta).toBeUndefined();
  });
});
