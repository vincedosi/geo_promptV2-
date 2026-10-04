import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { type JeuDetail, JeuxZonesApi } from '../data/jeux-zones.api';
import { JEU_DEFAUT } from '../logique/jeu';
import { AtelierJeuxService, MESSAGES_ATELIER, messageAtelier } from './atelier-jeux.service';

/** Un appel d'API factice : ses arguments, et le `Subject` par lequel le test répond quand il veut. */
interface Appel { nom: string; args: unknown[]; rep: Subject<unknown> }

function fausseApi() {
  const appels: Appel[] = [];
  const appeler = (nom: string) => (...args: unknown[]) => {
    const rep = new Subject<unknown>();
    appels.push({ nom, args, rep });
    return new Observable((o) => rep.subscribe(o));
  };
  const api = {
    lister: appeler('lister'), lire: appeler('lire'), construire: appeler('construire'),
    regler: appeler('regler'), supprimer: appeler('supprimer'),
  };
  /** Le dernier appel d'un nom, non encore répondu. */
  const dernier = (nom: string) => appels.filter((a) => a.nom === nom).at(-1)!;
  return { api, appels, dernier };
}

function repondre(a: Appel, valeur: unknown) {
  a.rep.next(valeur);
  a.rep.complete();
}

const DETAIL = (id: string, seuil: number, retenus: number): JeuDetail => ({
  jeu: {
    id, nom: 'Jeu', description: null, version: 1, created_at: '', construit_le: '2026-10-04',
    population_exposee: null, n_cp_retenus: retenus, taux_utile: null, mode_plan: 'pondere',
    seuil_couverture_cp: seuil, brouillon: true, profil: {}, profil_hash: 'h', poids: {},
  },
  classes: [{
    classe: 'haut:1', n_cp: 10, n_cp_retenus: retenus, population_en_zone: 100,
    population_en_zone_retenue: 80, population_achetee: 120,
  }],
});

/** Laisse filer les promesses (aucun minuteur dans le service). */
const vider = () => new Promise((r) => setTimeout(r, 0));

function creer() {
  const f = fausseApi();
  TestBed.configureTestingModule({
    providers: [ChargementService, AtelierJeuxService, { provide: JeuxZonesApi, useValue: f.api }],
  });
  const service = TestBed.inject(AtelierJeuxService);
  const chargement = TestBed.inject(ChargementService);
  TestBed.tick();
  return { service, chargement, ...f };
}

describe('AtelierJeuxService', () => {
  it('ne lit la bibliothèque qu’à la première demande, une seule fois', async () => {
    const { service, appels, dernier } = creer();
    expect(appels).toHaveLength(0);
    service.assurerBibliotheque();
    service.assurerBibliotheque();
    expect(appels.filter((a) => a.nom === 'lister')).toHaveLength(1);
    expect(service.etatBibliotheque()).toBe('chargement');
    repondre(dernier('lister'), { jeux: [{ id: 'a' }] });
    await vider();
    expect(service.etatBibliotheque()).toBe('pret');
    expect(service.bibliotheque()).toEqual([{ id: 'a' }]);
  });

  it('construire : POST du jeu, puis GET du détail ; chargement → pret, piste de progression active pendant', async () => {
    const { service, chargement, dernier } = creer();
    service.construire(JEU_DEFAUT);
    expect(service.etat()).toBe('chargement');
    TestBed.tick();
    expect(chargement.etat().actif).toBe(true);
    expect(dernier('construire').args).toEqual([JEU_DEFAUT]);
    repondre(dernier('construire'), { id: 'brouillon-1' });
    await vider();
    expect(dernier('lire').args).toEqual(['brouillon-1']);
    repondre(dernier('lire'), DETAIL('brouillon-1', 20, 5));
    await vider();
    expect(service.etat()).toBe('pret');
    expect(service.detail()?.jeu.id).toBe('brouillon-1');
    TestBed.tick();
    expect(chargement.etat().actif).toBe(false);
  });

  it('construire en échec : le message de la route, sinon celui de React ; état echec', async () => {
    const { service, dernier } = creer();
    service.construire(JEU_DEFAUT);
    dernier('construire').rep.error(new HttpErrorResponse({ status: 504, error: { message: 'upstream timeout' } }));
    await vider();
    expect(service.etat()).toBe('echec');
    expect(service.erreur()).toBe(MESSAGES_ATELIER.construction);
  });

  it('deux constructions dont les réponses reviennent inversées : seule la dernière s’affiche', async () => {
    const { service, appels } = creer();
    service.construire(JEU_DEFAUT);
    service.construire({ ...JEU_DEFAUT, territoire: '13' });
    const [c1, c2] = appels.filter((a) => a.nom === 'construire');
    repondre(c2, { id: 'b' });
    await vider();
    repondre(c1, { id: 'a' });
    await vider();
    const lectures = appels.filter((a) => a.nom === 'lire');
    expect(lectures.map((l) => l.args[0])).toEqual(['b']);
    repondre(lectures[0], DETAIL('b', 20, 3));
    await vider();
    expect(service.detail()?.jeu.id).toBe('b');
  });

  it('deux réglages successifs, réponses inversées : le détail affiché est celui du SECOND', async () => {
    const { service, appels, dernier } = creer();
    service.ouvrir('j');
    repondre(dernier('lire'), DETAIL('j', 20, 5));
    await vider();

    const r1 = service.regler({ seuil_couverture_cp: 30 });
    const r2 = service.regler({ seuil_couverture_cp: 35 });
    const [p1, p2] = appels.filter((a) => a.nom === 'regler');
    expect(p1.args).toEqual(['j', { seuil_couverture_cp: 30 }]);
    repondre(p2, {});
    await vider();
    repondre(p1, {});
    await vider();
    const [, l2, l3] = appels.filter((a) => a.nom === 'lire');
    repondre(l2, DETAIL('j', 35, 2)); // relecture du second
    await vider();
    repondre(l3, DETAIL('j', 30, 4)); // relecture du premier, arrivée APRÈS
    await vider();
    expect(await r1).toBe(true);
    expect(await r2).toBe(true);
    expect(service.detail()?.jeu.seuil_couverture_cp).toBe(35);
    expect(service.reglage()).toBe(2);
  });

  it('regler sans jeu ouvert ne fait rien ; un échec garde le détail et pose le message', async () => {
    const { service, appels, dernier } = creer();
    expect(await service.regler({ seuil_couverture_cp: 30 })).toBe(false);
    expect(appels).toHaveLength(0);
    service.ouvrir('j');
    repondre(dernier('lire'), DETAIL('j', 20, 5));
    await vider();
    const r = service.regler({ poids: { 'haut:1': 9 } });
    dernier('regler').rep.error(new HttpErrorResponse({ status: 400, error: { error: 'Poids hors bornes.' } }));
    expect(await r).toBe(false);
    expect(service.erreur()).toBe('Poids hors bornes.');
    expect(service.detail()?.jeu.id).toBe('j');
    expect(service.reglage()).toBe(0);
  });

  it('enregistrer relit aussi la bibliothèque', async () => {
    const { service, appels, dernier } = creer();
    service.ouvrir('j');
    repondre(dernier('lire'), DETAIL('j', 20, 5));
    await vider();
    const r = service.regler({ nom: 'Mon jeu', enregistrer: true });
    repondre(dernier('regler'), {});
    await vider();
    repondre(dernier('lire'), DETAIL('j', 20, 5));
    await vider();
    expect(appels.filter((a) => a.nom === 'lister')).toHaveLength(1);
    repondre(dernier('lister'), { jeux: [] });
    expect(await r).toBe(true);
  });

  it('supprimer le jeu ouvert : detail null, état vide, bibliothèque relue', async () => {
    const { service, appels, dernier } = creer();
    service.ouvrir('j');
    repondre(dernier('lire'), DETAIL('j', 20, 5));
    await vider();
    const r = service.supprimer('j');
    repondre(dernier('supprimer'), {});
    await vider();
    expect(service.detail()).toBeNull();
    expect(service.etat()).toBe('vide');
    repondre(dernier('lister'), { jeux: [] });
    expect(await r).toBe(true);
    expect(appels.filter((a) => a.nom === 'lister')).toHaveLength(1);
  });

  it('supprimer un AUTRE jeu laisse le jeu ouvert en place', async () => {
    const { service, dernier } = creer();
    service.ouvrir('j');
    repondre(dernier('lire'), DETAIL('j', 20, 5));
    await vider();
    const r = service.supprimer('k');
    repondre(dernier('supprimer'), {});
    await vider();
    repondre(dernier('lister'), { jeux: [] });
    await r;
    expect(service.detail()?.jeu.id).toBe('j');
    expect(service.etat()).toBe('pret');
  });

  it('ouvrirDepuisUrl : un jeu introuvable n’est PAS redemandé en boucle ; un autre identifiant l’est', async () => {
    const { service, appels, dernier } = creer();
    service.ouvrirDepuisUrl('absent');
    dernier('lire').rep.error(new HttpErrorResponse({ status: 404, error: { error: 'Jeu de zones introuvable.' } }));
    await vider();
    expect(service.etat()).toBe('echec');
    expect(service.erreur()).toBe('Jeu de zones introuvable.');
    service.ouvrirDepuisUrl('absent');
    expect(appels.filter((a) => a.nom === 'lire')).toHaveLength(1);
    service.ouvrirDepuisUrl('autre');
    expect(appels.filter((a) => a.nom === 'lire')).toHaveLength(2);
    service.ouvrirDepuisUrl(null);
    expect(appels.filter((a) => a.nom === 'lire')).toHaveLength(2);
  });

  it('construire oublie le jeu demandé par l’URL : le brouillon reste, un retour de l’URL sur le jeu le rouvre', async () => {
    const { service, appels, dernier } = creer();
    service.ouvrirDepuisUrl('x');
    repondre(dernier('lire'), DETAIL('x', 20, 5));
    await vider();
    service.construire(JEU_DEFAUT);
    repondre(dernier('construire'), { id: 'brouillon' });
    await vider();
    repondre(dernier('lire'), DETAIL('brouillon', 20, 3));
    await vider();
    expect(appels.filter((a) => a.nom === 'lire')).toHaveLength(2);
    expect(service.detail()?.jeu.id).toBe('brouillon');
    service.ouvrirDepuisUrl('x');
    expect(appels.filter((a) => a.nom === 'lire').map((a) => a.args[0])).toEqual(['x', 'brouillon', 'x']);
  });

  it('messageAtelier lit `error` du corps, jamais une levée', () => {
    expect(messageAtelier(new HttpErrorResponse({ status: 409, error: { error: 'Déjà là.' } }), 'd')).toBe('Déjà là.');
    expect(messageAtelier(new HttpErrorResponse({ status: 500, error: 'texte' }), 'd')).toBe('d');
    expect(messageAtelier(new Error('x'), 'd')).toBe('d');
  });
});
