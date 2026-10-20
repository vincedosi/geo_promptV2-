import { TestBed } from '@angular/core/testing';
import { HttpEventType } from '@angular/common/http';
import type { TestRequest } from '@angular/common/http/testing';
import { Component, inject } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { CategoriesPoiApi } from '../../commun/data/categories-poi.api';
import { OrganisationsListeApi } from '../../commun/data/organisations-liste.api';
import { ImportPoiApi } from '../data/import-poi.api';
import { CATEGORIES_REPLI, ORGANISATION_DEFAUT } from '../logique/constantes';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { ESSAI_A_BLANC, GEOCODAGE_ESSAI } from '../testing/geocodage.fixture';
import { FLUX_IMPORT_COMPLET, FLUX_SOURCE_IMPOSSIBLE } from '../testing/import-poi-sse.fixture';
import { ImportPoiService } from './import-poi.service';

const URL_PARSE = '/api/admin/import-poi/parse';
const URL_CATEGORIES = '/api/admin/poi-categories';
const URL_ORGANISATIONS = '/api/admin/organizations';

const CATEGORIES = [
  { categorie: 'lycee', label_fr: 'Tous les lycées', icone: '🎓' },
  { categorie: 'autre', label_fr: null, icone: null },
];

/** Le service vit dans un composant hôte (il est fourni par la page, détruit avec elle). */
@Component({ selector: 'mg-hote-essai', template: '', providers: [ImportPoiService] })
class Hote {
  readonly etat = inject(ImportPoiService);
}

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportPoiApi, CategoriesPoiApi, OrganisationsListeApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(Hote);
  return { f, etat: f.componentInstance.etat, http: TestBed.inject(HttpTestingController) };
}

const csv = (nom = 'poi-essai.csv') => new File(['nom;latitude;longitude\n'], nom, { type: 'text/csv' });

describe('ImportPoiService — état du parcours d’import POI (lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('état initial de React (`page.tsx:35-94`) : rien d’analysé, GPS, organisation par défaut, aucune étape au-delà de 01', () => {
    const { etat } = monter();
    expect(etat.fichiers()).toEqual([]);
    expect(etat.analyse()).toBeNull();
    expect(etat.categorie()).toBe('');
    expect(etat.modeGeo()).toBe('gps');
    expect(etat.correspondance()).toEqual({});
    expect(etat.correspondanceGeo()).toEqual({});
    expect(etat.nomSource()).toBe('');
    expect(etat.organisationId()).toBe(ORGANISATION_DEFAUT);
    expect(etat.etapeAccessible()).toMatchObject({ '02': false, '03': false, '03b': false });
  });

  describe('chargement au montage (`page.tsx:93-126`)', () => {
    it('UN GET organisations et UN GET catégories ; catégories → `{ val, label, icone }` (label_fr ou la clé, icône ou vide)', () => {
      const { etat, http } = monter();
      etat.charger();
      http.expectOne(URL_ORGANISATIONS).flush({ success: true, organizations: [{ id: 'o1', name: 'Espace A', slug: 'a' }] });
      const cat = http.expectOne(URL_CATEGORIES);
      expect(cat.request.method).toBe('GET');
      cat.flush({ success: true, categories: CATEGORIES });
      expect(etat.organisations()).toEqual([{ id: 'o1', name: 'Espace A' }]);
      expect(etat.categories()).toEqual([
        { val: 'lycee', label: 'Tous les lycées', icone: '🎓' },
        { val: 'autre', label: 'autre', icone: '' },
      ]);
    });

    it('cache par écran : un second `charger()` ne relit rien', () => {
      const { etat, http } = monter();
      etat.charger();
      http.expectOne(URL_ORGANISATIONS).flush({ success: true, organizations: [] });
      http.expectOne(URL_CATEGORIES).flush({ success: true, categories: CATEGORIES });
      etat.charger();
      http.expectNone(URL_ORGANISATIONS);
      http.expectNone(URL_CATEGORIES);
    });

    it('catégories : réseau coupé → repli codé en dur de React (défaut recopié, `page.tsx:116-125`)', () => {
      const { etat, http } = monter();
      etat.charger();
      http.expectOne(URL_ORGANISATIONS).flush({ success: true, organizations: [] });
      http.expectOne(URL_CATEGORIES).error(new ProgressEvent('error'));
      expect(etat.categories()).toEqual(CATEGORIES_REPLI);
    });

    it('catégories : corps illisible (HTML) → repli, comme `res.json()` qui lève', () => {
      const { etat, http } = monter();
      etat.charger();
      http.expectOne(URL_ORGANISATIONS).flush({ success: true, organizations: [] });
      http.expectOne(URL_CATEGORIES).flush('<html>502</html>', { status: 502, statusText: 'Bad Gateway' });
      expect(etat.categories()).toEqual(CATEGORIES_REPLI);
    });

    it('catégories : 500 JSON `{ success: false }` → PAS de repli, liste vide (React lit le JSON, `success` faux)', () => {
      const { etat, http } = monter();
      etat.charger();
      http.expectOne(URL_ORGANISATIONS).flush({ success: false, error: 'x' }, { status: 500, statusText: 'Erreur' });
      http.expectOne(URL_CATEGORIES).flush({ success: false, error: 'boom' }, { status: 500, statusText: 'Erreur' });
      expect(etat.categories()).toEqual([]);
      expect(etat.organisations()).toEqual([]);
    });
  });

  describe('dépôt (`handleFileUpload`, `page.tsx:132-186`)', () => {
    it('un CSV : POST multipart, `file` puis `files`, aucun `Content-Type` posé ; analyse → correspondance suggérée (valeurs non nulles), GPS, toutes les colonnes importées', () => {
      const { etat, http } = monter();
      etat.analyser([csv()]);
      expect(etat.analyseEnCours()).toBe(true);
      expect(etat.fichiers().map((f) => f.name)).toEqual(['poi-essai.csv']);
      const req = http.expectOne(URL_PARSE);
      expect(req.request.method).toBe('POST');
      const corps = req.request.body as FormData;
      expect([...corps.keys()]).toEqual(['file', 'files']);
      expect((corps.get('file') as File).name).toBe('poi-essai.csv');
      expect(req.request.headers.has('Content-Type')).toBe(false);
      req.flush(ANALYSE_POI_ESSAI);
      expect(etat.analyseEnCours()).toBe(false);
      expect(etat.analyse()).toEqual(ANALYSE_POI_ESSAI);
      expect(etat.correspondance()).toEqual({
        nom: 'nom', adresse: 'adresse', ville: 'ville', code_postal: 'code_postal', lat: 'latitude', lng: 'longitude',
        reference_panneau: 'code_postal',
      });
      expect(etat.correspondanceGeo()).toEqual({ colLat: 'latitude', colLng: 'longitude' });
      expect(etat.modeGeo()).toBe('gps');
      expect(etat.colonnesImportees()).toEqual(ANALYSE_POI_ESSAI.columns.map((c) => c.name));
      expect(etat.champsFiltres()).toEqual([]);
    });

    it('un Shapefile de 4 fichiers : `file` (le premier) puis 4 entrées `files`', () => {
      const { etat, http } = monter();
      const bundle = ['zones.shp', 'zones.dbf', 'zones.prj', 'zones.shx'].map((n) => new File(['x'], n));
      etat.analyser(bundle);
      const corps = http.expectOne(URL_PARSE).request.body as FormData;
      expect([...corps.keys()]).toEqual(['file', 'files', 'files', 'files', 'files']);
      expect((corps.getAll('files') as File[]).map((f) => f.name)).toEqual(['zones.shp', 'zones.dbf', 'zones.prj', 'zones.shx']);
      expect((corps.get('file') as File).name).toBe('zones.shp');
    });

    it('Lambert : `x` / `y` suggérés → `colX` / `colY` ; le mode reste celui d’avant faute de latitude (React ne le change qu’avec `lat`)', () => {
      const { etat, http } = monter();
      etat.choisirModeGeo('address');
      etat.analyser([csv('l93.csv')]);
      http.expectOne(URL_PARSE).flush({
        ...ANALYSE_POI_ESSAI, suggestedMapping: { nom: 'nom', x: 'X', y: 'Y', lat: null, lng: null },
      });
      expect(etat.correspondanceGeo()).toEqual({ colX: 'X', colY: 'Y' });
      expect(etat.modeGeo()).toBe('address');
    });

    it('refus 400 de la route : `{ success: false, error }` rendu tel quel (React lit le JSON)', () => {
      const { etat, http } = monter();
      etat.analyser([csv('a.pdf')]);
      http.expectOne(URL_PARSE).flush({ success: false, error: 'Format non supporté: .pdf' }, { status: 400, statusText: 'Bad Request' });
      expect(etat.analyse()).toEqual({ success: false, error: 'Format non supporté: .pdf' });
      expect(etat.etapeAccessible()['02']).toBe(false);
    });

    it('réseau coupé : « Failed to fetch » (message de `fetch`) ; corps illisible : « HTTP <statut> »', () => {
      const { etat, http } = monter();
      etat.analyser([csv()]);
      http.expectOne(URL_PARSE).error(new ProgressEvent('error'));
      expect(etat.analyse()).toEqual({ success: false, error: 'Failed to fetch' });
      etat.analyser([csv()]);
      http.expectOne(URL_PARSE).flush('<html></html>', { status: 504, statusText: 'Gateway Timeout' });
      expect(etat.analyse()).toEqual({ success: false, error: 'HTTP 504' });
    });

    it('changer de fichier : l’analyse précédente disparaît pendant la nouvelle ; colonnes, correspondance et filtres sont REMPLACÉS ; un dépôt plus récent annule le précédent', () => {
      const { etat, http } = monter();
      etat.analyser([csv()]);
      http.expectOne(URL_PARSE).flush(ANALYSE_POI_ESSAI);
      etat.choisirCategorie('lycee');
      etat.basculerFiltre('statut');
      etat.associer('departement', 'ville');
      expect(etat.etapeAccessible()).toMatchObject({ '02': true, '03': true, '03b': true });

      etat.analyser([csv('autre.csv')]);
      expect(etat.analyse()).toBeNull();
      expect(etat.etapeAccessible()).toMatchObject({ '02': false, '03': false, '03b': false });
      const premier = http.expectOne(URL_PARSE);
      etat.analyser([csv('dernier.csv')]);
      expect(premier.cancelled).toBe(true);
      http.expectOne(URL_PARSE).flush({
        ...ANALYSE_POI_ESSAI, columns: [{ name: 'NOM', sampleValues: [], nullCount: 0 }], suggestedMapping: { nom: 'NOM' },
      });
      expect(etat.fichiers().map((f) => f.name)).toEqual(['dernier.csv']);
      expect(etat.correspondance()).toEqual({ nom: 'NOM' });
      expect(etat.correspondanceGeo()).toEqual({});
      expect(etat.colonnesImportees()).toEqual(['NOM']);
      expect(etat.champsFiltres()).toEqual([]);
      // La catégorie n'est pas liée au fichier : React la garde.
      expect(etat.categorie()).toBe('lycee');
    });

    it('destruction de l’écran pendant l’analyse : la requête est annulée (elle n’écrit rien en base)', () => {
      const { f, etat, http } = monter();
      etat.analyser([csv()]);
      const req = http.expectOne(URL_PARSE);
      f.destroy();
      expect(req.cancelled).toBe(true);
    });
  });

  describe('création d’une catégorie (`CategoryStep.tsx:44-68`)', () => {
    function pret() {
      const m = monter();
      m.etat.charger();
      m.http.expectOne(URL_ORGANISATIONS).flush({ success: true, organizations: [] });
      m.http.expectOne(URL_CATEGORIES).flush({ success: true, categories: CATEGORIES });
      return m;
    }

    it('POST `{ categorie }` (nom rogné), puis RELECTURE de la liste, puis la catégorie normalisée choisie et le champ vidé', () => {
      const { etat, http } = pret();
      etat.nouvelleCategorie.set('  [ESSAI lot 6]  ');
      etat.creerCategorie();
      expect(etat.creationEnCours()).toBe(true);
      const post = http.expectOne((r) => r.url === URL_CATEGORIES && r.method === 'POST');
      expect(post.request.body).toEqual({ categorie: '[ESSAI lot 6]' });
      post.flush({ success: true, categorie: 'essai_lot_6' });
      const relecture = http.expectOne((r) => r.url === URL_CATEGORIES && r.method === 'GET');
      expect(etat.categorie()).toBe('');
      relecture.flush({ success: true, categories: [...CATEGORIES, { categorie: 'essai_lot_6', label_fr: '[ESSAI lot 6]', icone: '📍' }] });
      expect(etat.categories().map((c) => c.val)).toEqual(['lycee', 'autre', 'essai_lot_6']);
      expect(etat.categorie()).toBe('essai_lot_6');
      expect(etat.nouvelleCategorie()).toBe('');
      expect(etat.creationEnCours()).toBe(false);
    });

    it('nom vide : aucune requête', () => {
      const { etat, http } = pret();
      etat.nouvelleCategorie.set('   ');
      etat.creerCategorie();
      http.expectNone(URL_CATEGORIES);
    });

    it('refus de la route : notification avec le message, aucune relecture, rien de choisi (React se taisait)', () => {
      const { etat, http } = pret();
      const notifs = TestBed.inject(NotificationsService);
      const erreur = vi.spyOn(notifs, 'error');
      etat.nouvelleCategorie.set('x');
      etat.creerCategorie();
      http.expectOne((r) => r.method === 'POST').flush({ success: false, error: 'Nom de categorie requis' }, { status: 400, statusText: 'Bad Request' });
      http.expectNone((r) => r.url === URL_CATEGORIES && r.method === 'GET');
      expect(erreur).toHaveBeenCalledWith('Création de la catégorie échouée', 'Nom de categorie requis');
      expect(etat.categorie()).toBe('');
      expect(etat.nouvelleCategorie()).toBe('x');
      expect(etat.creationEnCours()).toBe(false);
    });
  });

  describe('correspondance et colonnes', () => {
    function analyse() {
      const m = monter();
      m.etat.analyser([csv()]);
      m.http.expectOne(URL_PARSE).flush(ANALYSE_POI_ESSAI);
      return m;
    }

    it('« — Non mappe — » sur un champ standard le retire (`v || undefined`) ; sur une colonne géo il la vide (`\'\'`)', () => {
      const { etat } = analyse();
      etat.associer('nom', '');
      expect(etat.correspondance()['nom']).toBeUndefined();
      etat.associerGeo('colLat', '');
      expect(etat.correspondanceGeo()).toEqual({ colLat: '', colLng: 'longitude' });
    });

    it('étapes (mêmes règles que React, `page.tsx:418-423`) : 02 dès l’analyse réussie, 03 avec une catégorie, 03b avec la géolocalisation complète', () => {
      const { etat } = analyse();
      expect(etat.etapeAccessible()).toMatchObject({ '02': true, '03': false, '03b': false });
      etat.choisirCategorie('lycee');
      expect(etat.etapeAccessible()).toMatchObject({ '02': true, '03': true, '03b': true });
      etat.associerGeo('colLng', '');
      expect(etat.etapeAccessible()['03b']).toBe(false);
      // Adresse : une adresse OU une ville, du mapping géo OU du mapping standard.
      etat.choisirModeGeo('address');
      expect(etat.etapeAccessible()['03b']).toBe(true); // `mapping.adresse` suggéré
      etat.associer('adresse', '');
      etat.associer('ville', '');
      expect(etat.etapeAccessible()['03b']).toBe(false);
      etat.associerGeo('colVille', 'ville');
      expect(etat.etapeAccessible()['03b']).toBe(true);
      // Lambert : X ET Y.
      etat.choisirModeGeo('lambert93');
      expect(etat.etapeAccessible()['03b']).toBe(false);
      etat.associerGeo('colX', 'capacite');
      etat.associerGeo('colY', 'statut');
      expect(etat.etapeAccessible()['03b']).toBe(true);
    });

    it('`configGeo` = `buildGeoConfig` (`page.tsx:206-215`) pour les trois modes', () => {
      const { etat } = analyse();
      expect(etat.configGeo()).toEqual({ mode: 'gps', colLat: 'latitude', colLng: 'longitude' });
      etat.choisirModeGeo('address');
      etat.associerGeo('colVille', 'ville');
      expect(etat.configGeo()).toEqual({ mode: 'address', colAdresse: 'adresse', colCodePostal: 'code_postal', colVille: 'ville' });
      etat.choisirModeGeo('lambert93');
      expect(etat.configGeo()).toEqual({ mode: 'lambert93', colX: undefined, colY: undefined });
    });

    it('décocher « Importer » retire aussi le filtre ; « Tout importer » ne prend que les colonnes libres ; « Tout exclure » vide les deux ; « Effacer filtres »', () => {
      const { etat } = analyse();
      etat.basculerFiltre('statut');
      etat.basculerFiltre('capacite');
      expect(etat.champsFiltres()).toEqual(['statut', 'capacite']);
      etat.basculerImport('statut');
      expect(etat.colonnesImportees()).not.toContain('statut');
      expect(etat.champsFiltres()).toEqual(['capacite']);
      etat.toutImporter(['capacite', 'statut']);
      expect(etat.colonnesImportees()).toEqual(['capacite', 'statut']);
      etat.effacerFiltres();
      expect(etat.champsFiltres()).toEqual([]);
      etat.basculerFiltre('statut');
      etat.toutExclure();
      expect(etat.colonnesImportees()).toEqual([]);
      expect(etat.champsFiltres()).toEqual([]);
    });
  });
});

const URL_GEOCODAGE = '/api/admin/geocode/batch';
const URL_CORRECTION = '/api/admin/geocode/update';
const URL_ESSAI = '/api/admin/import-poi/dry-run';
const URL_IMPORT = '/api/admin/import-poi/execute';

describe('ImportPoiService — géocodage, essai à blanc et import en flux (lot 6, T13)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  /** Fichier analysé, catégorie choisie : GPS complet (latitude / longitude suggérées). */
  function pret() {
    const m = monter();
    m.etat.charger();
    m.http.expectOne(URL_ORGANISATIONS).flush({ success: true, organizations: [{ id: 'o1', name: 'Espace A' }] });
    m.http.expectOne(URL_CATEGORIES).flush({ success: true, categories: CATEGORIES });
    m.etat.analyser([csv()]);
    m.http.expectOne(URL_PARSE).flush(ANALYSE_POI_ESSAI);
    m.etat.choisirCategorie('essai_lot_6');
    return m;
  }

  /** Mode adresse, géocodage servi par la fixture. */
  function geocode() {
    const m = pret();
    m.etat.choisirModeGeo('address');
    m.etat.geocoder();
    m.http.expectOne(URL_GEOCODAGE).flush(GEOCODAGE_ESSAI);
    return m;
  }

  function essaiReussi(m: ReturnType<typeof pret>) {
    m.etat.essayer();
    m.http.expectOne(URL_ESSAI).flush(ESSAI_A_BLANC);
  }

  function morceau(req: TestRequest, flux: string, jusqua: string) {
    const bout = flux.indexOf(jusqua);
    req.event({ type: HttpEventType.DownloadProgress, loaded: bout, partialText: flux.slice(0, bout) });
  }

  describe('accès aux étapes (`page.tsx:425-426, 511, 544, 555`)', () => {
    it('GPS : pas de 03c, 04 dès la géolocalisation complète, 05 après un essai réussi avec au moins une ligne valide', () => {
      const m = pret();
      expect(m.etat.etapeAccessible()).toEqual({ '02': true, '03': true, '03b': true, '03c': false, '04': true, '05': false });
      m.etat.essayer();
      m.http.expectOne(URL_ESSAI).flush({ ...ESSAI_A_BLANC, stats: { ...ESSAI_A_BLANC.stats, validRows: 0 } });
      expect(m.etat.etapeAccessible()['05']).toBe(false);
      essaiReussi(m);
      expect(m.etat.etapeAccessible()['05']).toBe(true);
    });

    it('adresse : 03c visible, 04 BLOQUÉE tant que le géocodage n’est pas validé (`isGeocodeReady`, l.426)', () => {
      const m = pret();
      m.etat.choisirModeGeo('address');
      expect(m.etat.etapeAccessible()).toMatchObject({ '03c': true, '04': false });
      m.etat.geocoder();
      m.http.expectOne(URL_GEOCODAGE).flush(GEOCODAGE_ESSAI);
      expect(m.etat.etapeAccessible()['04']).toBe(false);
      m.etat.validerGeocodage();
      expect(m.etat.etapeAccessible()['04']).toBe(true);
      m.etat.relancerGeocodage();
      expect(m.etat.etapeAccessible()['04']).toBe(false);
      expect([m.etat.geocodeId(), m.etat.statsGeocodage(), m.etat.erreurGeocodage()]).toEqual([null, null, null]);
    });
  });

  describe('géocodage (`handleGeocodeBatch`, `handleGeocodeUpdateRow`)', () => {
    it('corps EXACT : `fileId` et les colonnes d’adresse de `buildGeoConfig` (repli sur le mapping standard) ; résultats et compteurs gardés', () => {
      const m = pret();
      m.etat.choisirModeGeo('address');
      m.etat.geocoder();
      expect(m.etat.geocodageEnCours()).toBe(true);
      const req = m.http.expectOne(URL_GEOCODAGE);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        fileId: ANALYSE_POI_ESSAI.fileId, colAdresse: 'adresse', colCodePostal: 'code_postal', colVille: 'ville',
      });
      req.flush(GEOCODAGE_ESSAI);
      expect(m.etat.geocodageEnCours()).toBe(false);
      expect(m.etat.geocodeId()).toBe('1b2c3d4e-5f60');
      expect(m.etat.resultatsGeocodage()).toEqual(GEOCODAGE_ESSAI.results);
      expect(m.etat.statsGeocodage()).toEqual({ green: 1, orange: 1, red: 2 });
      expect(m.etat.geocodageValide()).toBe(false);
    });

    it('refus (`{ success: false, error }`, même en 400) : le message de la route ; sans message « Erreur geocodage » ; réseau : « Failed to fetch »', () => {
      const m = pret();
      m.etat.choisirModeGeo('address');
      m.etat.geocoder();
      m.http.expectOne(URL_GEOCODAGE).flush({ success: false, error: 'Au moins une colonne adresse ou ville est requise' }, { status: 400, statusText: 'Bad Request' });
      expect(m.etat.erreurGeocodage()).toBe('Au moins une colonne adresse ou ville est requise');
      expect(m.etat.geocodeId()).toBeNull();
      m.etat.geocoder();
      expect(m.etat.erreurGeocodage()).toBeNull();
      m.http.expectOne(URL_GEOCODAGE).flush({ success: false });
      expect(m.etat.erreurGeocodage()).toBe('Erreur geocodage');
      m.etat.geocoder();
      m.http.expectOne(URL_GEOCODAGE).error(new ProgressEvent('error'));
      expect(m.etat.erreurGeocodage()).toBe('Failed to fetch');
      expect(m.etat.geocodageEnCours()).toBe(false);
    });

    for (const [nom, action] of [
      ['manual', { type: 'manual', lat: 45.75, lng: 4.83 }],
      ['reGeocode', { type: 'reGeocode', address: 'Place Bellecour, Lyon' }],
      ['ignore', { type: 'ignore' }],
    ] as const) {
      it(`correction « ${nom} » : corps { geocodeId, rowIndex, action } exact ; succès → la ligne remplacée, compteurs relus, édition fermée`, () => {
        const m = geocode();
        m.etat.ouvrirEdition(GEOCODAGE_ESSAI.results![2]);
        expect(m.etat.ligneEditee()).toBe(2);
        m.etat.corriger(2, action);
        expect(m.etat.correctionEnCours()).toBe(true);
        const req = m.http.expectOne(URL_CORRECTION);
        expect(req.request.body).toEqual({ geocodeId: '1b2c3d4e-5f60', rowIndex: 2, action });
        const corrigee = { ...GEOCODAGE_ESSAI.results![2], status: 'green' as const, score: 1, manualOverride: true, resultLabel: 'Saisie manuelle' };
        req.flush({ success: true, updatedResult: corrigee, stats: { green: 2, orange: 1, red: 1 } });
        expect(m.etat.resultatsGeocodage()[2]).toEqual(corrigee);
        expect(m.etat.statsGeocodage()).toEqual({ green: 2, orange: 1, red: 1 });
        expect(m.etat.ligneEditee()).toBeNull();
        expect([m.etat.adresseEditee(), m.etat.latEditee(), m.etat.lngEditee()]).toEqual(['', '', '']);
        expect(m.etat.correctionEnCours()).toBe(false);
      });
    }

    it('correction refusée : notifiée avec le message de la route (React se taisait), la ligne et l’édition inchangées', () => {
      const m = geocode();
      const erreur = vi.spyOn(TestBed.inject(NotificationsService), 'error');
      m.etat.ouvrirEdition(GEOCODAGE_ESSAI.results![2]);
      m.etat.corriger(2, { type: 'ignore' });
      m.http.expectOne(URL_CORRECTION).flush({ success: false, error: 'geocodeId invalide' }, { status: 400, statusText: 'Bad Request' });
      expect(erreur).toHaveBeenCalledWith('Correction du géocodage échouée', 'geocodeId invalide');
      expect(m.etat.resultatsGeocodage()[2]).toEqual(GEOCODAGE_ESSAI.results![2]);
      expect(m.etat.ligneEditee()).toBe(2);
      expect(m.etat.correctionEnCours()).toBe(false);
    });

    it('relancer le géocodage PENDANT une correction : `correctionEnCours` repasse à faux (boutons réactivés), la réponse tardive est ignorée', () => {
      const m = geocode();
      m.etat.ouvrirEdition(GEOCODAGE_ESSAI.results![2]);
      m.etat.corriger(2, { type: 'ignore' });
      const tardive = m.http.expectOne(URL_CORRECTION);
      expect(m.etat.correctionEnCours()).toBe(true);
      m.etat.relancerGeocodage();
      expect(m.etat.correctionEnCours()).toBe(false);
      m.etat.geocoder();
      m.http.expectOne(URL_GEOCODAGE).flush({ ...GEOCODAGE_ESSAI, geocodeId: '0b3c4d5e-6f70-4a81-9b92-a3b4c5d6e7f8' });
      expect(tardive.cancelled).toBe(false);
      tardive.flush({ success: true, updatedResult: { ...GEOCODAGE_ESSAI.results![2], status: 'green' }, stats: { green: 2, orange: 1, red: 1 } });
      expect(m.etat.correctionEnCours()).toBe(false);
      expect(m.etat.statsGeocodage()).toEqual({ green: 1, orange: 1, red: 2 });
      expect(m.etat.resultatsGeocodage()[2]).toEqual(GEOCODAGE_ESSAI.results![2]);
    });

    it('vague finale E3 — correction ouverte et filtre posé, puis nouveau fichier : formulaire fermé et vidé, filtre « all »', () => {
      const m = geocode();
      m.etat.ouvrirEdition(GEOCODAGE_ESSAI.results![0]);
      m.etat.filtreGeocodage.set('red');
      expect(m.etat.ligneEditee()).not.toBeNull();
      m.etat.analyser([csv('autre.csv')]);
      m.http.expectOne(URL_PARSE).flush(ANALYSE_POI_ESSAI);
      expect([m.etat.ligneEditee(), m.etat.adresseEditee(), m.etat.latEditee(), m.etat.lngEditee()]).toEqual([null, '', '', '']);
      expect(m.etat.filtreGeocodage()).toBe('all');
    });

    it('ouvrir l’édition recopie l’adresse et les coordonnées ; la rouvrir la ferme (« Corriger » / « Fermer »)', () => {
      const m = geocode();
      m.etat.ouvrirEdition(GEOCODAGE_ESSAI.results![1]);
      expect([m.etat.ligneEditee(), m.etat.adresseEditee(), m.etat.latEditee(), m.etat.lngEditee()])
        .toEqual([1, 'Quai du Port 13002 Marseille', '43.2965', '5.3698']);
      m.etat.ouvrirEdition(GEOCODAGE_ESSAI.results![1]);
      expect(m.etat.ligneEditee()).toBeNull();
    });
  });

  describe('essai à blanc (`handleDryRun`, `page.tsx:293-326`)', () => {
    it('GPS : corps EXACT (`dataType: poi`, catégorie, mapping, `buildGeoConfig`, `limit: 100`), sans `geocodeId`', () => {
      const m = pret();
      m.etat.essayer();
      expect(m.etat.essaiEnCours()).toBe(true);
      const req = m.http.expectOne(URL_ESSAI);
      expect(req.request.body).toEqual({
        fileId: ANALYSE_POI_ESSAI.fileId, dataType: 'poi', category: 'essai_lot_6',
        mapping: m.etat.correspondance(),
        geolocation: { mode: 'gps', colLat: 'latitude', colLng: 'longitude' }, limit: 100,
      });
      expect(Object.keys(req.request.body as object)).not.toContain('geocodeId');
      req.flush(ESSAI_A_BLANC);
      expect(m.etat.essai()).toEqual(ESSAI_A_BLANC);
      expect(m.etat.essaiEnCours()).toBe(false);
    });

    it('adresse : le `geocodeId` du géocodage est joint', () => {
      const m = geocode();
      m.etat.validerGeocodage();
      m.etat.essayer();
      const corps = m.http.expectOne(URL_ESSAI).request.body as Record<string, unknown>;
      expect(corps['geocodeId']).toBe('1b2c3d4e-5f60');
      expect(corps['geolocation']).toEqual({ mode: 'address', colAdresse: 'adresse', colCodePostal: 'code_postal', colVille: 'ville' });
    });

    it('refus JSON (400 / 404 / 500) rendu tel quel ; réseau : « Failed to fetch » ; corps illisible : « HTTP <statut> »', () => {
      const m = pret();
      m.etat.essayer();
      m.http.expectOne(URL_ESSAI).flush({ success: false, error: 'geocodeId invalide' }, { status: 400, statusText: 'Bad Request' });
      expect(m.etat.essai()).toEqual({ success: false, error: 'geocodeId invalide' });
      m.etat.essayer();
      expect(m.etat.essai()).toBeNull();
      m.http.expectOne(URL_ESSAI).error(new ProgressEvent('error'));
      expect(m.etat.essai()).toEqual({ success: false, error: 'Failed to fetch' });
      m.etat.essayer();
      m.http.expectOne(URL_ESSAI).flush('<html></html>', { status: 502, statusText: 'Bad Gateway' });
      expect(m.etat.essai()).toEqual({ success: false, error: 'HTTP 502' });
    });
  });

  describe('import en flux (`handleImport`, `page.tsx:332-410`)', () => {
    function lancer(m: ReturnType<typeof pret>): TestRequest {
      m.etat.demanderImport();
      m.etat.confirmerImport();
      return m.http.expectOne(URL_IMPORT);
    }

    it('confirmation d’abord : demander n’envoie RIEN ; annuler ferme sans requête ; confirmer ferme et envoie le corps EXACT', () => {
      const m = pret();
      essaiReussi(m);
      m.etat.demanderImport();
      expect(m.etat.confirmationImport()).toBe(true);
      m.http.expectNone(URL_IMPORT);
      m.etat.annulerImport();
      expect(m.etat.confirmationImport()).toBe(false);
      m.http.expectNone(URL_IMPORT);

      m.etat.basculerImport('capacite');
      m.etat.basculerFiltre('statut');
      m.etat.nomSource.set('  Essai lot 6  ');
      m.etat.organisationId.set('o1');
      const req = lancer(m);
      expect(m.etat.confirmationImport()).toBe(false);
      expect(req.request.body).toEqual({
        fileId: ANALYSE_POI_ESSAI.fileId, dataType: 'poi', category: 'essai_lot_6',
        mapping: m.etat.correspondance(),
        geolocation: { mode: 'gps', colLat: 'latitude', colLng: 'longitude' },
        sourceName: 'Essai lot 6', organizationId: 'o1',
        importedColumns: ['nom', 'adresse', 'code_postal', 'ville', 'latitude', 'longitude', 'statut'],
        filterFields: ['statut'],
      });
      req.flush(FLUX_IMPORT_COMPLET);
    });

    it('nom vide, aucune colonne, aucun filtre : `sourceName`, `importedColumns`, `filterFields` ABSENTS (`undefined`, l.348-351)', () => {
      const m = pret();
      essaiReussi(m);
      m.etat.toutExclure();
      m.etat.nomSource.set('   ');
      const req = lancer(m);
      const corps = req.request.body as Record<string, unknown>;
      expect(corps['sourceName']).toBeUndefined();
      expect(corps['importedColumns']).toBeUndefined();
      expect(corps['filterFields']).toBeUndefined();
      expect(corps['organizationId']).toBe(ORGANISATION_DEFAUT);
      req.flush(FLUX_IMPORT_COMPLET);
    });

    it('flux en morceaux : `log` → journal ; le reste → progression nommée (libellés de la route) ; `complete` → rapport', () => {
      const m = pret();
      essaiReussi(m);
      const req = lancer(m);
      expect(m.etat.importEnCours()).toBe(true);
      expect(m.etat.etatProgression()).toMatchObject({ etape: 'Lancement', traitees: null, total: null, termine: false, echec: null });

      morceau(req, FLUX_IMPORT_COMPLET, 'data: {"type":"progress","message":"Fichier parse');
      expect(m.etat.etatProgression()).toMatchObject({ etape: 'Parsing du fichier...', total: null });
      expect(m.etat.journal()).toEqual([]);

      morceau(req, FLUX_IMPORT_COMPLET, 'data: {"type":"log","logLevel":"info","logLine":"--- Batch');
      // Vague finale E4 : le journal « Insertion en base… » fait basculer l'étape (la route n'envoie plus de message).
      expect(m.etat.etatProgression()).toMatchObject({ etape: 'Insertion en base Supabase', traitees: 0, total: 10 });
      expect(m.etat.journal().map((l) => l.line)).toEqual([
        'Insertion en base Supabase (10 lignes)...',
        '====== START: 10 lignes, type="poi" (Supabase JS) ======',
        'Connexion Supabase OK — table "poi_france"',
      ]);
      expect(m.etat.compteurs()).toEqual({ processed: 0, total: 10 });

      morceau(req, FLUX_IMPORT_COMPLET, 'data: {"type":"complete"');
      expect(m.etat.etatProgression()).toMatchObject({ etape: 'Insertion en base Supabase', traitees: 10, total: 10, termine: false });
      expect(m.etat.compteurs()).toEqual({ processed: 10, total: 10, inserted: 10, ignored: 0, errors: 0 });
      expect(m.etat.rapport()).toBeNull();

      req.flush(FLUX_IMPORT_COMPLET);
      expect(m.etat.rapport()).toEqual({ total: 10, inserted: 10, ignored: 0, errors: 0 });
      expect(m.etat.premiereErreur()).toBeNull();
      expect(m.etat.etatProgression()).toMatchObject({ termine: true, echec: null });
      expect(m.etat.journal()).toHaveLength(16);
      expect(m.etat.journal()[4]).toEqual({ level: 'info', line: '[OK] #0 [ESSAI lot 6] POI 01 (48.8566, 2.3522) → insere' });
      expect(m.etat.importEnCours()).toBe(false);
    });

    it('A3 — `error` « Impossible de créer la source de données… » puis fin : message d’échec et ligne au journal, AUCUN rapport, barre jamais à 100 %', () => {
      const m = pret();
      essaiReussi(m);
      lancer(m).flush(FLUX_SOURCE_IMPOSSIBLE);
      const message = 'Impossible de créer la source de données : import arrêté, aucune ligne écrite.';
      expect(m.etat.progression()).toEqual({ type: 'error', message });
      expect(m.etat.etatProgression()).toMatchObject({ echec: message, termine: false, traitees: 0, total: 10 });
      expect(m.etat.journal().at(-1)).toEqual({ level: 'error', line: `! ${message}` });
      expect(JSON.stringify(m.etat.journal())).not.toContain('interrompu');
      expect(m.etat.rapport()).toBeNull();
      expect(m.etat.importEnCours()).toBe(false);
    });

    it('flux sans `complete` ni `error` : « Le flux s’est interrompu avant la fin. » (règle du lot 3), pas de rapport', () => {
      const m = pret();
      essaiReussi(m);
      lancer(m).flush(FLUX_IMPORT_COMPLET.slice(0, FLUX_IMPORT_COMPLET.indexOf('data: {"type":"log","logLevel":"info","logLine":"====== FIN')));
      expect(m.etat.progression()).toEqual({ type: 'error', message: 'Le flux s’est interrompu avant la fin.' });
      expect(m.etat.etatProgression()).toMatchObject({ echec: 'Le flux s’est interrompu avant la fin.', termine: false });
      expect(m.etat.journal().at(-1)).toEqual({ level: 'error', line: '! Le flux s’est interrompu avant la fin.' });
      expect(m.etat.rapport()).toBeNull();
    });

    it('refus HTTP (corps texte JSON) : `! <error>` ; corps illisible : `HTTP <statut>` ; le bouton revient', () => {
      const m = pret();
      essaiReussi(m);
      lancer(m).flush('{"error":"Non autorisé"}', { status: 403, statusText: 'Forbidden' });
      expect(m.etat.progression()).toEqual({ type: 'error', message: 'Non autorisé' });
      expect(m.etat.importEnCours()).toBe(false);
      lancer(m).flush('<html></html>', { status: 500, statusText: 'Server Error' });
      expect(m.etat.progression()).toEqual({ type: 'error', message: 'HTTP 500' });
    });

    it('rapport à `firstError` : gardé pour le bloc « Erreur SQL detectee »', () => {
      const m = pret();
      essaiReussi(m);
      lancer(m).flush('data: {"type":"complete","report":{"total":10,"inserted":0,"ignored":0,"errors":10},"firstError":"column \\"x\\" does not exist"}\n\n');
      expect(m.etat.rapport()).toEqual({ total: 10, inserted: 0, ignored: 0, errors: 10 });
      expect(m.etat.premiereErreur()).toBe('column "x" does not exist');
    });

    it('destruction pendant l’import : la requête N’EST PAS annulée (C13), la suite est ignorée sans erreur', () => {
      const m = pret();
      essaiReussi(m);
      const req = lancer(m);
      morceau(req, FLUX_IMPORT_COMPLET, 'data: {"type":"log","logLevel":"info","logLine":"--- Batch');
      m.f.destroy();
      expect(req.cancelled).toBe(false);
      expect(() => req.flush(FLUX_IMPORT_COMPLET)).not.toThrow();
    });

    it('nouveau fichier : essai, rapport, progression, journal ET géocodage remis à zéro ; l’import en cours continue mais n’écrit plus l’écran', () => {
      const m = geocode();
      m.etat.validerGeocodage();
      essaiReussi(m);
      const req = lancer(m);
      morceau(req, FLUX_IMPORT_COMPLET, 'data: {"type":"log","logLevel":"info","logLine":"--- Batch');
      m.etat.analyser([csv('autre.csv')]);
      expect(req.cancelled).toBe(false);
      expect([m.etat.essai(), m.etat.rapport(), m.etat.progression(), m.etat.etatProgression(), m.etat.compteurs()]).toEqual([null, null, null, null, null]);
      expect(m.etat.journal()).toEqual([]);
      expect([m.etat.geocodeId(), m.etat.statsGeocodage(), m.etat.geocodageValide()]).toEqual([null, null, false]);
      expect(m.etat.resultatsGeocodage()).toEqual([]);
      expect(m.etat.importEnCours()).toBe(false);
      req.flush(FLUX_IMPORT_COMPLET);
      expect(m.etat.rapport()).toBeNull();
      expect(m.etat.journal()).toEqual([]);
      m.http.expectOne(URL_PARSE).flush(ANALYSE_POI_ESSAI);
    });
  });
});
