import { TestBed } from '@angular/core/testing';
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
    expect(etat.etapeAccessible()).toEqual({ '02': false, '03': false, '03b': false });
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
      expect(etat.etapeAccessible()).toEqual({ '02': true, '03': true, '03b': true });

      etat.analyser([csv('autre.csv')]);
      expect(etat.analyse()).toBeNull();
      expect(etat.etapeAccessible()).toEqual({ '02': false, '03': false, '03b': false });
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
      expect(etat.etapeAccessible()).toEqual({ '02': true, '03': false, '03b': false });
      etat.choisirCategorie('lycee');
      expect(etat.etapeAccessible()).toEqual({ '02': true, '03': true, '03b': true });
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
