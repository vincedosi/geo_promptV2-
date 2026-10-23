import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, type Subscriber } from 'rxjs';
import { CouvertureApi } from '../data/couverture.api';
import type { ResultatCouverture, ResultatCroisements } from '../logique/analyses/couverture';
import { ParcoursService } from './parcours.service';
import { ZoneAnalyseeService } from './zone-analysee.service';

const Z1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const Z2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Une API factice : chaque appel est une requête en attente, qu'on résout ou rejette à la main, et dont on voit l'annulation. */
class ApiFactice {
  readonly appels: Array<{ args: [string, string, string]; sortie: Subscriber<ResultatCouverture> | null; annulee: boolean }> = [];
  couverture(...args: [string, string, string]): Observable<ResultatCouverture> {
    return new Observable<ResultatCouverture>((s) => {
      const appel = { args, sortie: s, annulee: false };
      this.appels.push(appel);
      return () => { appel.annulee = true; };
    });
  }
  /** Radio et trafic (T13), même mécanique. */
  readonly lectures: Array<{ id: string; sortie: Subscriber<ResultatCroisements>; annulee: boolean }> = [];
  croisements(id: string): Observable<ResultatCroisements> {
    return new Observable<ResultatCroisements>((s) => {
      const lecture = { id, sortie: s, annulee: false };
      this.lectures.push(lecture);
      return () => { lecture.annulee = true; };
    });
  }
}
const croisements = { radio: { n_emetteurs: 3 } } as unknown as ResultatCroisements;
const resultat = (zone_id: string, population: number) => ({ zone_id, population } as unknown as ResultatCouverture);

@Component({ selector: 'mg-hote-zone', template: '<router-outlet />', providers: [ZoneAnalyseeService, ParcoursService], imports: [RouterOutlet] })
class Hote { readonly zone = inject(ZoneAnalyseeService); readonly parcours = inject(ParcoursService); }
@Component({ selector: 'mg-module', template: '' }) class Module {}

const attendre = () => new Promise((r) => setTimeout(r, 0));

async function ouvrir(url: string) {
  const api = new ApiFactice();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'carte', component: Hote, children: [{ path: 'risques', component: Module }] }, { path: 'ailleurs', component: Module }]),
      { provide: CouvertureApi, useValue: api },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const hote = await harness.navigateByUrl(url, Hote);
  const stable = async () => { await attendre(); await harness.fixture.whenStable(); };
  await stable();
  return { harness, hote, api, router: TestBed.inject(Router), stable };
}

describe('ZoneAnalyseeService — l’URL', () => {
  it('lu à la construction : zone, cible et découpage', async () => {
    const { hote } = await ouvrir(`/carte?zoneAnalyse=${Z1}&couverture=ind_18_24.iris`);
    expect(hote.zone.zoneId()).toBe(Z1);
    expect(hote.zone.cible()).toBe('ind_18_24');
    expect(hote.zone.decoupage()).toBe('iris');
  });
  it('rien dans l’URL : aucune zone, défauts, URL inchangée', async () => {
    const { hote, router, api } = await ouvrir('/carte');
    expect(hote.zone.zoneId()).toBeNull();
    expect([hote.zone.cible(), hote.zone.decoupage()]).toEqual(['ind', 'forme']);
    expect(router.url).toBe('/carte');
    expect(api.appels).toHaveLength(0);
  });
  it('valeurs illisibles : réécrites une fois sous forme canonique', async () => {
    const { hote, router } = await ouvrir('/carte?zoneAnalyse=pas-un-uuid&couverture=ind.commune');
    expect(hote.zone.zoneId()).toBeNull();
    expect(router.url).toBe('/carte');
  });
  it('choisir écrit ?zoneAnalyse= en replaceUrl ; régler écrit ?couverture= ; le défaut ne s’écrit pas', async () => {
    const { hote, router, stable } = await ouvrir('/carte');
    const nav = vi.spyOn(router, 'navigate');
    hote.zone.choisir(Z1);
    await stable();
    expect(router.url).toBe(`/carte?zoneAnalyse=${Z1}`);
    expect(nav.mock.calls[0][1]).toMatchObject({ replaceUrl: true });
    hote.zone.regler({ decoupage: 'cp' });
    await stable();
    expect(router.url).toBe(`/carte?zoneAnalyse=${Z1}&couverture=ind.cp`);
    hote.zone.regler({ decoupage: 'forme' });
    hote.zone.choisir(null);
    await stable();
    expect(router.url).toBe('/carte');
  });
  it('P-g : ?zoneAnalyse= et ?etape= écrits dans le même tick — les deux restent', async () => {
    const { hote, router, stable } = await ouvrir('/carte');
    hote.zone.choisir(Z1);
    hote.parcours.choisir('analyse');
    await stable(); await stable();
    expect(router.url).toContain(`zoneAnalyse=${Z1}`);
    expect(router.url).toContain('etape=analyse');
  });
  it('P-g, dans l’autre ordre : ?etape= puis ?zoneAnalyse=', async () => {
    const { hote, router, stable } = await ouvrir('/carte');
    hote.parcours.choisir('analyse');
    hote.zone.choisir(Z1);
    hote.zone.regler({ decoupage: 'iris' });
    await stable(); await stable();
    expect(router.url).toContain(`zoneAnalyse=${Z1}`);
    expect(router.url).toContain('etape=analyse');
    expect(router.url).toContain('couverture=ind.iris');
  });
  it('une navigation extérieure (lien collé, retour) change la zone et efface le résultat', async () => {
    const { hote, api, router, stable } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.chiffrer();
    api.appels[0].sortie?.next(resultat(Z1, 10));
    expect(hote.zone.resultat()).not.toBeNull();
    await router.navigateByUrl(`/carte?zoneAnalyse=${Z2}&etape=analyse`);
    await stable();
    expect(hote.zone.zoneId()).toBe(Z2);
    expect(hote.zone.resultat()).toBeNull();
  });
  it('le module risque ouvert (route enfant) : l’écriture garde la route enfant', async () => {
    const { hote, router, stable } = await ouvrir('/carte/risques');
    hote.zone.choisir(Z1);
    await stable();
    expect(router.url).toBe(`/carte/risques?zoneAnalyse=${Z1}`);
  });
});

describe('ZoneAnalyseeService — le chiffrage', () => {
  it('aucun appel avant chiffrer() ; chiffrer appelle avec zone, cible, découpage', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}&couverture=ind.cp`);
    expect(api.appels).toHaveLength(0);
    hote.zone.chiffrer();
    expect(api.appels.map((a) => a.args)).toEqual([[Z1, 'ind', 'cp']]);
    expect(hote.zone.enCours()).toBe(true);
    api.appels[0].sortie?.next(resultat(Z1, 42));
    expect(hote.zone.resultat()?.population).toBe(42);
    expect(hote.zone.enCours()).toBe(false);
  });
  it('sans zone : chiffrer ne fait rien', async () => {
    const { hote, api } = await ouvrir('/carte');
    hote.zone.chiffrer();
    expect(api.appels).toHaveLength(0);
  });
  it('deux chiffrer() rapides : la première requête est annulée, seule la seconde réponse est gardée', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.chiffrer();
    hote.zone.chiffrer();
    expect(api.appels[0].annulee).toBe(true);
    api.appels[0].sortie?.next(resultat(Z1, 1));
    expect(hote.zone.resultat()).toBeNull();
    api.appels[1].sortie?.next(resultat(Z1, 2));
    expect(hote.zone.resultat()?.population).toBe(2);
  });
  it('réponse arrivée APRÈS choisir(autre) : jetée, requête annulée', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.chiffrer();
    hote.zone.choisir(Z2);
    expect(api.appels[0].annulee).toBe(true);
    api.appels[0].sortie?.next(resultat(Z1, 1));
    expect(hote.zone.resultat()).toBeNull();
    expect(hote.zone.enCours()).toBe(false);
  });
  it('changer la cible ou le découpage efface le résultat ; rien ne repart seul', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.chiffrer();
    api.appels[0].sortie?.next(resultat(Z1, 1));
    hote.zone.regler({ decoupage: 'iris' });
    expect(hote.zone.resultat()).toBeNull();
    hote.zone.regler({ cible: 'ind_65p' });
    expect(api.appels).toHaveLength(1);
  });
  it('404 zone_introuvable : ?zoneAnalyse= retiré, message affiché', async () => {
    const { hote, api, router, stable } = await ouvrir(`/carte?zoneAnalyse=${Z1}&etape=analyse`);
    hote.zone.chiffrer();
    api.appels[0].sortie?.error(new HttpErrorResponse({
      status: 404, error: { error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' },
    }));
    expect(hote.zone.erreur()).toBe('Zone introuvable dans cet espace.');
    expect(hote.zone.zoneId()).toBeNull();
    await stable();
    expect(router.url).toBe('/carte?etape=analyse');
    expect(hote.zone.erreur()).toBe('Zone introuvable dans cet espace.');
  });
  it('422 : message, la zone reste', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.chiffrer();
    api.appels[0].sortie?.error(new HttpErrorResponse({ status: 422, error: { error: 'La zone compte plus de 400 000 carreaux habités.', refus: 'trop_de_carreaux' } }));
    expect(hote.zone.erreur()).toBe('La zone compte plus de 400 000 carreaux habités.');
    expect(hote.zone.zoneId()).toBe(Z1);
  });
  it('service détruit (page recréée au changement d’espace) : lecture annulée, plus aucune écriture d’URL', async () => {
    const { hote, api, router, stable } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    const zone = hote.zone;
    zone.chiffrer();
    await router.navigateByUrl('/ailleurs');
    await stable();
    expect(api.appels[0].annulee).toBe(true);
    const nav = vi.spyOn(router, 'navigate');
    zone.choisir(Z2);
    zone.chiffrer();
    await stable();
    expect(nav).not.toHaveBeenCalled();
    expect(api.appels).toHaveLength(1);
    expect(router.url).toBe('/ailleurs');
  });
});

describe('ZoneAnalyseeService — radio et trafic (T13, ronde 1 : P-e)', () => {
  it('lus au geste seulement ; le résultat survit au réglage de la cible (et au repli du panneau : il vit ici)', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    expect(api.lectures).toHaveLength(0);
    hote.zone.lireCroisements();
    expect(api.lectures.map((l) => l.id)).toEqual([Z1]);
    api.lectures[0].sortie.next(croisements);
    hote.zone.regler({ cible: 'men_pauv', decoupage: 'cp' });
    expect(hote.zone.croisements.resultat()).toBe(croisements);
  });
  it('changer de zone (geste ou URL) efface le résultat et annule la lecture en vol', async () => {
    const { hote, api, router, stable } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.lireCroisements();
    api.lectures[0].sortie.next(croisements);
    hote.zone.lireCroisements();
    hote.zone.choisir(Z2);
    expect(api.lectures[1].annulee).toBe(true);
    expect(hote.zone.croisements.resultat()).toBeNull();
    await stable();
    hote.zone.lireCroisements();
    api.lectures[2].sortie.next(croisements);
    expect(hote.zone.croisements.resultat()).toBe(croisements);
    await router.navigateByUrl(`/carte?zoneAnalyse=${Z1}`);
    await stable();
    expect(hote.zone.croisements.resultat()).toBeNull();
  });
  it('404 zone_introuvable : la zone est retirée, comme pour le chiffrage, et le message SURVIT au retrait', async () => {
    const { hote, api, stable } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.lireCroisements();
    api.lectures[0].sortie.error(new HttpErrorResponse({ status: 404, error: { error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' } }));
    expect(hote.zone.zoneId()).toBeNull();
    expect(hote.zone.croisements.erreur()).toBe('Zone introuvable dans cet espace.');
    await stable();
    expect(hote.zone.croisements.erreur()).toBe('Zone introuvable dans cet espace.');
  });
  it('T13 M4 : un chiffrage d’une AUTRE version de la forme (recalcul en ③) périme la liste ; la même version la garde', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    const lue = { ...croisements, zone_maj: 'v1' } as ResultatCroisements;
    hote.zone.lireCroisements();
    api.lectures[0].sortie.next(lue);
    hote.zone.chiffrer();
    api.appels[0].sortie?.next({ ...resultat(Z1, 10), zone_maj: 'v1' });
    expect(hote.zone.croisements.resultat()).toBe(lue);
    hote.zone.chiffrer();
    api.appels[1].sortie?.next({ ...resultat(Z1, 12), zone_maj: 'v2' });
    expect(hote.zone.croisements.resultat()).toBeNull();
  });
  it('un chiffrage revenu PENDANT une lecture radio/trafic ne l’annule pas', async () => {
    const { hote, api } = await ouvrir(`/carte?zoneAnalyse=${Z1}`);
    hote.zone.lireCroisements();
    hote.zone.chiffrer();
    api.appels[0].sortie?.next({ ...resultat(Z1, 10), zone_maj: 'v1' });
    expect(api.lectures[0].annulee).toBe(false);
    const lue = { ...croisements, zone_maj: 'v1' } as ResultatCroisements;
    api.lectures[0].sortie.next(lue);
    expect(hote.zone.croisements.resultat()).toBe(lue);
  });
});
