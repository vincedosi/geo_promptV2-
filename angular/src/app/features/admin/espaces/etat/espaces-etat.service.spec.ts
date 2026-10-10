import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { EspacesApi } from '../data/espaces.api';
import type { EspaceResume, ReponseEspaces } from '../logique/types';
import { EspacesEtatService } from './espaces-etat.service';

const URL = '/api/admin/espaces';

function espace(p: Partial<EspaceResume> & { id: string }): EspaceResume {
  return {
    nom: p.id, nom_affiche: p.id, slug: p.id, actif: true, interne: false, nb_membres: 0, nb_jeux_prives: 0, ...p,
  };
}

function reponse(): ReponseEspaces {
  return { socle: { nb_jeux: 3 }, espaces: [espace({ id: 'a', nb_membres: 2 }), espace({ id: 'b' })], nb_comptes: 5 };
}

describe('EspacesEtatService', () => {
  let etat: EspacesEtatService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), EspacesApi, EspacesEtatService, NotificationsService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    etat = TestBed.inject(EspacesEtatService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('avant tout appel : liste vide, pas de socle, ni chargement ni erreur', () => {
    expect(etat.espaces()).toEqual([]);
    expect(etat.socle()).toBeNull();
    expect(etat.nbComptes()).toBeNull();
    expect(etat.chargement()).toBe(false);
    expect(etat.erreur()).toBeNull();
  });

  it('charger() deux fois → UN seul GET (cache) ; la liste et le socle sont posés', () => {
    etat.charger();
    expect(etat.chargement()).toBe(true);
    etat.charger();
    http.expectOne(URL).flush(reponse());
    expect(etat.chargement()).toBe(false);
    expect(etat.espaces().map((e) => e.id)).toEqual(['a', 'b']);
    expect(etat.socle()).toEqual({ nb_jeux: 3 });
    expect(etat.nbComptes()).toBe(5);
    etat.charger();
    http.expectNone(URL);
  });

  it('recharger() → un nouveau GET, la liste est remplacée', () => {
    etat.charger();
    http.expectOne(URL).flush(reponse());
    etat.recharger();
    http.expectOne(URL).flush({ socle: { nb_jeux: 4 }, espaces: [espace({ id: 'c' })], nb_comptes: 6 });
    expect(etat.espaces().map((e) => e.id)).toEqual(['c']);
    expect(etat.socle()).toEqual({ nb_jeux: 4 });
    expect(etat.nbComptes()).toBe(6);
  });

  it('erreur 500 → `erreur()` porte le message du serveur, `espaces()` vide ; charger() relance alors', () => {
    etat.charger();
    http.expectOne(URL).flush({ error: 'Base indisponible' }, { status: 500, statusText: 'Server Error' });
    expect(etat.erreur()).toBe('Base indisponible');
    expect(etat.espaces()).toEqual([]);
    expect(etat.chargement()).toBe(false);
    etat.charger();
    http.expectOne(URL).flush(reponse());
    expect(etat.erreur()).toBeNull();
    expect(etat.espaces()).toHaveLength(2);
  });

  it('recharger en échec garde la liste et le socle ; l\'erreur est notifiée, pas posée sur la page', () => {
    const erreurs = vi.spyOn(TestBed.inject(NotificationsService), 'error');
    etat.charger();
    http.expectOne(URL).flush(reponse());
    etat.recharger();
    http.expectOne(URL).flush({ error: 'Coupure passagère' }, { status: 500, statusText: 'Server Error' });
    expect(etat.espaces().map((e) => e.id)).toEqual(['a', 'b']);
    expect(etat.socle()).toEqual({ nb_jeux: 3 });
    expect(etat.nbComptes()).toBe(5);
    expect(etat.chargement()).toBe(false);
    // `erreur()` remplacerait la colonne par un bloc d'erreur : réservé au premier chargement.
    expect(etat.erreur()).toBeNull();
    expect(erreurs).toHaveBeenCalledWith('Coupure passagère');
    // Une relecture suivante qui réussit remplace la liste comme d'habitude.
    etat.recharger();
    http.expectOne(URL).flush({ socle: { nb_jeux: 4 }, espaces: [espace({ id: 'c' })] });
    expect(etat.espaces().map((e) => e.id)).toEqual(['c']);
  });

  it('espace(id) suit la liste (computed) : null avant, l\'espace après, null s\'il disparaît', () => {
    const a = etat.espace('a');
    expect(a()).toBeNull();
    etat.charger();
    http.expectOne(URL).flush(reponse());
    expect(a()?.nb_membres).toBe(2);
    etat.recharger();
    http.expectOne(URL).flush({ socle: { nb_jeux: 3 }, espaces: [espace({ id: 'b' })] });
    expect(a()).toBeNull();
  });
});
