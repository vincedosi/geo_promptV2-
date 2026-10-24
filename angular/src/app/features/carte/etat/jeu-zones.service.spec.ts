import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { CouvertureApi } from '../data/couverture.api';
import { JeuxApi } from '../data/jeux.api';
import type { PlateformeGeo } from '../logique/jeu/plateformes';
import { JeuZonesService } from './jeu-zones.service';
import { ParcoursService } from './parcours.service';

const Z1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const Z2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const J1 = '16fd2706-8baf-433b-82eb-8c7fada847da';

const regle = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: p.maille, natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});
/** Le registre du 24/10, réduit à ce que les tests lisent. */
const REGISTRE: PlateformeGeo[] = [
  regle({ plateforme: 'dv360', maille: 'cp' }),
  regle({ plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1000, pop_min_unite: 1000 } }),
  regle({ plateforme: 'ttd', maille: 'polygone', a_verifier: true }),
  regle({ plateforme: 'ttd', maille: 'cp', a_verifier: true }),
  regle({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 200, rayon_min_m: 1000, rayon_max_m: 80000 } }),
  regle({ plateforme: 'meta', maille: 'cp', a_verifier: true }),
  regle({ plateforme: 'tiktok', maille: 'departement', limites: { max_unites: 3000, pop_min_groupe: 1000 } }),
  regle({ plateforme: 'tiktok', maille: 'commune', a_verifier: true }),
];

const couvertureCp = {
  zone_id: Z1, cible: 'ind', decoupage: 'cp', population: 1000, surface_km2: 10, n_carreaux: 5,
  lignes: [
    { code: '13001', nom: null, commune: null, n_carreaux: 2, pop_en_zone: 600, pop_totale: 1000, part: 60 },
    { code: '13002', nom: null, commune: null, n_carreaux: 2, pop_en_zone: 300, pop_totale: 1000, part: 30 },
    { code: '13003', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 100, pop_totale: 1000, part: 10 },
  ],
};
const cercles = (rayon_m: number, seuil: number) => ({
  zone_id: Z1, cible: 'ind', rayon_m, seuil, n_candidates: 9, n_cercles: 3, cercles: [], population: 1000, couverte: 900,
  manques: 100, hors_zone: 300, achetee: 1200, taux_utile: 75, n_carreaux: 5, motif_vide: null,
});

@Component({ selector: 'mg-hote-jeu', template: '<router-outlet />', providers: [JeuZonesService, ParcoursService], imports: [RouterOutlet] })
class Hote { readonly jeu = inject(JeuZonesService); readonly parcours = inject(ParcoursService); }
@Component({ selector: 'mg-module', template: '' }) class Module {}

const attendre = () => new Promise((r) => setTimeout(r, 0));
const couverture = (zone: string, decoupage: string, cible = 'ind') => `/api/zones/${zone}/couverture?cible=${cible}&decoupage=${decoupage}`;

async function ouvrir(url: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'carte', component: Hote, children: [{ path: 'risques', component: Module }] }, { path: 'ailleurs', component: Module }]),
      provideHttpClient(), provideHttpClientTesting(), JeuxApi, CouvertureApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const hote = await harness.navigateByUrl(url, Hote);
  const stable = async () => { await attendre(); await harness.fixture.whenStable(); };
  await stable();
  return { hote, http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router), stable };
}

/** Une zone arrivée par l'URL, le registre lu (une fois par page). */
async function ouvrirAvecZone(suite = '') {
  const o = await ouvrir(`/carte?zoneJeu=${Z1}${suite}`);
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
  await o.stable();
  return o;
}

describe('JeuZonesService — l’URL', () => {
  it('rien dans l’URL : aucune zone, aucune requête, URL inchangée (ouvrir ⑤ ne lit rien)', async () => {
    const { hote, http, router } = await ouvrir('/carte');
    expect([hote.jeu.zoneId(), hote.jeu.jeuId()]).toEqual([null, null]);
    expect(router.url).toBe('/carte');
    http.verify();
  });
  it('lue à la construction : zone, choix explicites, défauts du registre pour les autres plateformes', async () => {
    const { hote, http } = await ouvrirAvecZone('&mailles=dv360.cp.35,meta.cercle.5000.20');
    expect(hote.jeu.zoneId()).toBe(Z1);
    expect(hote.jeu.choix()).toEqual({
      dv360: { maille: 'cp', seuil: 35 },
      meta: { maille: 'cercle', seuil: 20, rayon_m: 5000 },
      // Défauts (A-4) : TTD n'a que des mailles « à vérifier » → la plus exacte ; TikTok → la maille sûre.
      ttd: { maille: 'polygone', seuil: 20 },
      tiktok: { maille: 'departement', seuil: 20 },
    });
    http.verify();
  });
  it('valeurs illisibles : réécrites une fois sous forme canonique', async () => {
    const { router, http, stable } = await ouvrir(`/carte?zoneJeu=pas-un-uuid&mailles=n%20importe%20quoi&x=abc`);
    await stable();
    expect(router.url).toBe('/carte');
    http.verify();
  });
  it('régler écrit ?mailles= en replaceUrl, relatif ; retirer la zone efface tout', async () => {
    const { hote, router, stable } = await ouvrirAvecZone();
    hote.jeu.regler('dv360', { seuil: 50 });
    hote.jeu.regler('meta', { rayon: 12000 });
    await stable();
    expect(router.url).toBe(`/carte?zoneJeu=${Z1}&mailles=dv360.cp.50,meta.cercle.12000.20`);
    hote.jeu.choisirZone(null);
    await stable();
    expect(router.url).toBe('/carte');
    expect(hote.jeu.choix()).toEqual({});
  });
  it('P-g : ?mailles= et ?etape= écrits dans le même tick — les deux restent', async () => {
    const { hote, router, stable } = await ouvrirAvecZone();
    hote.jeu.regler('dv360', { seuil: 35 });
    hote.parcours.choisir('jeu');
    await stable(); await stable();
    expect(router.url).toContain('mailles=dv360.cp.35');
    expect(router.url).toContain('etape=jeu');
    expect(router.url).toContain(`zoneJeu=${Z1}`);
  });
});

describe('JeuZonesService — la conversion', () => {
  it('régler le seuil ne lance AUCUNE requête : le bilan se rejoue côté client (P-h)', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp')).flush(couvertureCp);
    expect(hote.jeu.resumes().dv360?.resume).toMatchObject({ n_unites: 2, couverte: 900, achetee: 2000, manques: 100 });
    hote.jeu.regler('dv360', { seuil: 50 });
    http.expectNone(() => true);
    expect(hote.jeu.resumes().dv360?.resume).toMatchObject({ n_unites: 1, couverte: 600, achetee: 1000, manques: 400, taux_utile: 60 });
    // La couverture est en mémoire : revalider ne relit rien.
    hote.jeu.valider('dv360');
    http.verify();
  });
  it('une maille exacte (polygone) : la population de la zone, aucune perte, sans seuil', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('ttd');
    http.expectOne(couverture(Z1, 'forme')).flush({ ...couvertureCp, decoupage: 'forme', lignes: [] });
    expect(hote.jeu.resumes().ttd?.resume).toMatchObject({ exacte: true, n_unites: 1, couverte: 1000, manques: 0, hors_zone: 0 });
  });
  it('au plus UNE couverture par maille, et une à la fois (file séquentielle)', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.regler('meta', { maille: 'cp' });
    hote.jeu.valider('dv360');
    hote.jeu.valider('meta');
    hote.jeu.valider('tiktok');
    const cp = http.expectOne(couverture(Z1, 'cp'));
    http.expectNone(couverture(Z1, 'departement'));
    expect(hote.jeu.enCours()).toEqual({ dv360: true, meta: true, tiktok: true });
    cp.flush(couvertureCp);
    http.expectOne(couverture(Z1, 'departement')).flush({ ...couvertureCp, decoupage: 'departement' });
    expect(hote.jeu.enCours()).toEqual({});
    expect(Object.keys(hote.jeu.couvertures()).sort()).toEqual(['cp', 'departement']);
    http.verify();
  });
  it('rayon : une requête au valider, rien au réglage ; deux rayons rapides → seule la seconde réponse compte', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.regler('meta', { rayon: 5000 });
    http.expectNone(() => true);
    hote.jeu.valider('meta');
    const premiere = http.expectOne((r) => r.url.includes('/cercles'));
    hote.jeu.regler('meta', { rayon: 8000 });
    hote.jeu.valider('meta');
    expect(premiere.cancelled).toBe(true);
    const seconde = http.expectOne(`/api/zones/${Z1}/cercles?cible=ind&rayon=8000&seuil=20&plateforme=meta`);
    seconde.flush(cercles(8000, 20));
    expect(hote.jeu.cercles().meta?.rayon_m).toBe(8000);
    expect(hote.jeu.resumes().meta?.resume).toMatchObject({ exacte: false, n_unites: 3, n_touchees: 9, taux_utile: 75 });
  });
  it('cercles : un second valider identique (double relâchement) ne relance pas la demande en vol', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('meta');
    const enVol = http.expectOne((r) => r.url.includes('/cercles'));
    hote.jeu.valider('meta');
    expect(enVol.cancelled).toBe(false);
    http.expectNone((r) => r.url.includes('/cercles'));
  });
  it('cercles : un seuil changé périme le pavage (calculé au serveur) sans requête, jusqu’au valider suivant', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(cercles(10000, 20));
    expect(hote.jeu.resumes().meta).toBeDefined();
    hote.jeu.regler('meta', { seuil: 40 });
    http.expectNone(() => true);
    expect(hote.jeu.resumes().meta).toBeUndefined();
    hote.jeu.valider('meta');
    http.expectOne(`/api/zones/${Z1}/cercles?cible=ind&rayon=10000&seuil=40&plateforme=meta`);
  });
  it('une réponse arrivée après choisirZone(autre) est jetée ; changer de zone efface tout résultat', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('ttd');
    http.expectOne(couverture(Z1, 'forme')).flush({ ...couvertureCp, decoupage: 'forme', lignes: [] });
    hote.jeu.valider('dv360');
    const enVol = http.expectOne(couverture(Z1, 'cp'));
    hote.jeu.choisirZone(Z2);
    expect(enVol.cancelled).toBe(true);
    expect(hote.jeu.couvertures()).toEqual({});
    expect(hote.jeu.resumes()).toEqual({});
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z2, 'cp'));
  });
  it('Review Focus 2 : une couverture d’une autre version de la forme (zone_maj) purge l’ancienne ET les pavages — aucun bilan mêlé', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('ttd');
    http.expectOne(couverture(Z1, 'forme')).flush({ ...couvertureCp, decoupage: 'forme', lignes: [], zone_maj: 'v1' });
    hote.jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(cercles(10000, 20));
    expect(Object.keys(hote.jeu.resumes()).sort()).toEqual(['meta', 'ttd']);
    // La zone a été recalculée en ③ (même id) : la couverture CP arrive sur la nouvelle forme.
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp')).flush({ ...couvertureCp, zone_maj: 'v2' });
    expect(Object.keys(hote.jeu.couvertures())).toEqual(['cp']);
    expect(hote.jeu.cercles()).toEqual({});
    expect(Object.keys(hote.jeu.resumes())).toEqual(['dv360']);
    // Les deux autres se relisent sur la nouvelle forme.
    hote.jeu.valider('ttd');
    http.expectOne(couverture(Z1, 'forme'));
  });
  it('même version de la forme : rien n’est purgé', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('ttd');
    http.expectOne(couverture(Z1, 'forme')).flush({ ...couvertureCp, decoupage: 'forme', lignes: [], zone_maj: 'v1' });
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp')).flush({ ...couvertureCp, zone_maj: 'v1' });
    expect(Object.keys(hote.jeu.couvertures()).sort()).toEqual(['cp', 'forme']);
  });
  it('choisirZone(même zone, recette, autre maj) : la date entre dans la clé, tout se relit au retour en ⑤', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.choisirZone(Z1, null, '2026-10-24T10:00:00Z');
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp')).flush(couvertureCp);
    expect(hote.jeu.resumes().dv360).toBeDefined();
    hote.jeu.choisirZone(Z1, null, '2026-10-24T10:00:00Z');
    hote.jeu.valider('dv360');
    http.expectNone(couverture(Z1, 'cp'));
    hote.jeu.choisirZone(Z1, null, '2026-10-24T11:00:00Z');
    expect(hote.jeu.resumes()).toEqual({});
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp'));
  });
  it('conversion d’abord, date ensuite (zone arrivée par l’URL) : la date est ADOPTÉE, rien n’est vidé ni relu', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp')).flush(couvertureCp);
    hote.jeu.choisirZone(Z1, { v: 1, type: 'dessin' }, '2026-10-24T10:00:00Z');
    expect(hote.jeu.resumes().dv360).toBeDefined();
    hote.jeu.valider('dv360');
    http.expectNone(couverture(Z1, 'cp'));
    // Une AUTRE date ensuite (recalcul en ③) vide toujours tout.
    hote.jeu.choisirZone(Z1, null, '2026-10-24T11:00:00Z');
    expect(hote.jeu.resumes()).toEqual({});
  });
  it('la date arrive pendant la lecture : la lecture en vol n’est pas annulée, elle se range sous la nouvelle clé', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('dv360');
    const enVol = http.expectOne(couverture(Z1, 'cp'));
    hote.jeu.choisirZone(Z1, null, '2026-10-24T10:00:00Z');
    hote.jeu.valider('dv360');
    expect(enVol.cancelled).toBe(false);
    enVol.flush(couvertureCp);
    expect(hote.jeu.resumes().dv360).toBeDefined();
    hote.jeu.valider('dv360');
    http.verify();
  });
  it('choisirCible : une autre cible, une autre lecture ; revenir à la première ne relit rien', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp')).flush(couvertureCp);
    hote.jeu.choisirCible('csp_plus');
    expect(hote.jeu.cible()).toBe('csp_plus');
    expect(hote.jeu.resumes()).toEqual({});
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp', 'csp_plus')).flush({ ...couvertureCp, cible: 'csp_plus' });
    hote.jeu.choisirCible('ind');
    hote.jeu.valider('dv360');
    http.verify();
    expect(hote.jeu.resumes().dv360).toBeDefined();
  });
  it('choisirMode : le mode de plan avant enregistrement (pondéré par défaut)', async () => {
    const { hote } = await ouvrirAvecZone();
    expect(hote.jeu.modePlan()).toBe('pondere');
    hote.jeu.choisirMode('exclusif');
    expect(hote.jeu.modePlan()).toBe('exclusif');
  });
  it('erreur d’une conversion : message pour les plateformes de cette maille, la zone reste', async () => {
    const { hote, http } = await ouvrirAvecZone();
    hote.jeu.valider('tiktok');
    http.expectOne(couverture(Z1, 'departement'))
      .flush({ error: 'La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.', refus: 'zone_trop_vaste' }, { status: 422, statusText: 'x' });
    expect(hote.jeu.erreurs().tiktok).toBe('La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.');
    expect(hote.jeu.zoneId()).toBe(Z1);
  });
  it('404 zone_introuvable : ?zoneJeu= retiré, message affiché', async () => {
    const { hote, http, router, stable } = await ouvrirAvecZone('&etape=jeu');
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'cp'))
      .flush({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' }, { status: 404, statusText: 'x' });
    expect(hote.jeu.zoneId()).toBeNull();
    expect(hote.jeu.erreur()).toBe('Zone introuvable dans cet espace.');
    await stable();
    expect(router.url).toBe('/carte?etape=jeu');
  });
});

describe('JeuZonesService — un jeu enregistré', () => {
  const detail = {
    jeu: { id: J1, type: 'zone', nom: 'Lycées', description: null, version: 1, created_at: '2026-10-24', custom_geo_zone_id: Z1, cible: 'ind_18_24', mode_plan: 'pondere' },
    zone: { id: Z1, nom: 'Lycées BdR', recette: { v: 1, type: 'codes_postaux', codes: ['13001', '13002'] } },
    plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 25, rayon_m: null }],
  };
  it('charger : ?jeu= écrit, ?zoneJeu= et ?mailles= retirés ; zone, cible, recette et choix du jeu', async () => {
    const { hote, http, router, stable } = await ouvrirAvecZone('&mailles=dv360.cp.35');
    hote.jeu.charger(J1);
    http.expectOne(`/api/zones/jeux/${J1}`).flush(detail);
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}`);
    expect([hote.jeu.zoneId(), hote.jeu.cible()]).toEqual([Z1, 'ind_18_24']);
    expect(hote.jeu.choix()).toEqual({ dv360: { maille: 'cp', seuil: 25 } });
    // Recette codes postaux : le CP est exact, le bilan se lit sur la forme.
    hote.jeu.valider('dv360');
    http.expectOne(couverture(Z1, 'forme', 'ind_18_24')).flush({ ...couvertureCp, decoupage: 'forme', lignes: [] });
    expect(hote.jeu.resumes().dv360?.resume).toMatchObject({ exacte: true, n_unites: 2 });
  });
  it('adopter (T12) : le jeu enregistré devient le jeu ouvert SANS relecture — ?jeu= posé, ?zoneJeu= et ?mailles= retirés', async () => {
    const { hote, http, router, stable } = await ouvrirAvecZone('&mailles=dv360.cp.25');
    hote.jeu.adopter(detail as never);
    await stable();
    http.expectNone(`/api/zones/jeux/${J1}`);
    expect(router.url).toBe(`/carte?jeu=${J1}`);
    expect(hote.jeu.jeu()?.jeu.nom).toBe('Lycées');
    expect(hote.jeu.choix()).toEqual({ dv360: { maille: 'cp', seuil: 25 } });
    // Une réponse tardive d'une AUTRE zone n'est pas adoptée.
    hote.jeu.choisirZone(Z2);
    hote.jeu.adopter(detail as never);
    expect(hote.jeu.jeuId()).toBeNull();
  });
  it('?jeu= lu à la construction : le jeu est relu, ses écarts dans ?mailles= gardés, ?x= gardé', async () => {
    const { hote, http, router, stable } = await ouvrir(`/carte?jeu=${J1}&mailles=dv360.cp.40&x=2`);
    http.expectOne(`/api/zones/jeux/${J1}`).flush(detail);
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    expect(hote.jeu.choix().dv360).toEqual({ maille: 'cp', seuil: 40 });
    expect(hote.jeu.extraction()).toBe(2);
    expect(router.url).toBe(`/carte?jeu=${J1}&mailles=dv360.cp.40&x=2`);
  });
  it('?x= : une extraction du jeu ouvert ; choisir une autre zone ferme le jeu et retire ?jeu= et ?x=', async () => {
    const { hote, http, router, stable } = await ouvrir(`/carte?jeu=${J1}`);
    http.expectOne(`/api/zones/jeux/${J1}`).flush(detail);
    hote.jeu.choisirExtraction(3);
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}&x=3`);
    hote.jeu.choisirZone(Z2);
    await stable();
    expect([hote.jeu.jeuId(), hote.jeu.extraction(), hote.jeu.jeu()]).toEqual([null, null, null]);
    expect(router.url).toBe(`/carte?zoneJeu=${Z2}`);
  });
  it('404 : ?jeu= retiré, « Jeu de zones introuvable dans cet espace. »', async () => {
    const { hote, http, router, stable } = await ouvrir(`/carte?jeu=${J1}&etape=jeu`);
    http.expectOne(`/api/zones/jeux/${J1}`)
      .flush({ error: 'Jeu de zones introuvable dans cet espace.' }, { status: 404, statusText: 'x' });
    await stable();
    expect(hote.jeu.jeuId()).toBeNull();
    expect(hote.jeu.erreur()).toBe('Jeu de zones introuvable dans cet espace.');
    expect(router.url).toBe('/carte?etape=jeu');
  });
  it('un jeu RISQUE : refusé avec l’endroit où il se gère, ?jeu= retiré', async () => {
    const { hote, http, router, stable } = await ouvrir(`/carte?jeu=${J1}`);
    http.expectOne(`/api/zones/jeux/${J1}`).flush({ jeu: { id: J1, nom: 'Seveso' }, classes: [], codes_postaux: [] });
    await stable();
    expect(hote.jeu.jeuId()).toBeNull();
    expect(hote.jeu.erreur()).toBe('Ce jeu de zones se gère dans le module risque.');
    expect(router.url).toBe('/carte');
  });
});

describe('JeuZonesService — fourni par la page', () => {
  it('service détruit (page recréée au changement d’espace) : lecture annulée, plus aucune écriture d’URL', async () => {
    const { hote, http, router, stable } = await ouvrirAvecZone();
    const jeu = hote.jeu;
    jeu.valider('dv360');
    const enVol = http.expectOne(couverture(Z1, 'cp'));
    await router.navigateByUrl('/ailleurs');
    await stable();
    expect(enVol.cancelled).toBe(true);
    const nav = vi.spyOn(router, 'navigate');
    jeu.choisirZone(Z2);
    jeu.valider('dv360');
    await stable();
    expect(nav).not.toHaveBeenCalled();
    http.verify();
    expect(router.url).toBe('/ailleurs');
  });
});
