import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { ImportGeoApi, type LigneCarreau } from '../data/import-geo.api';
import { CHARGEUR_PROJ4, chargerProj4 } from '../logique/charger-proj4';
import { fichiersEssai } from '../testing/shapefile.fixture';
import { ImportShapefileService } from './import-shapefile.service';

const URL_LOT = '/api/admin/import-geo';
const URL_REGISTER = '/api/admin/import-geo/register';
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const espaces = (s: string) => s.replace(/\s/g, ' ');

describe('ImportShapefileService — lecture, envoi par lots, enregistrement (lot 6, T14)', { timeout: 20_000 }, () => {
  let http: HttpTestingController;
  let chargeur: ReturnType<typeof vi.fn>;
  let injecteur: ReturnType<typeof createEnvironmentInjector>;
  let etat: ImportShapefileService;

  beforeEach(() => {
    chargeur = vi.fn(chargerProj4);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ImportGeoApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
        { provide: CHARGEUR_PROJ4, useValue: chargeur },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    injecteur = createEnvironmentInjector([ImportShapefileService], TestBed.inject(EnvironmentInjector));
    etat = injecteur.get(ImportShapefileService);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  /** Attend qu'une requête vers `url` soit en vol (l'envoi enchaîne promesses et cessions `setTimeout(0)`). */
  async function requete(url: string): Promise<TestRequest> {
    for (let i = 0; i < 50; i++) {
      const r = http.match(url);
      if (r.length > 1) throw new Error(`${r.length} requêtes ${url} en vol à la fois`);
      if (r.length === 1) return r[0];
      await tick();
    }
    throw new Error(`aucune requête ${url}`);
  }

  async function lire(n = 50) {
    await etat.lire(fichiersEssai(n));
  }

  it('lecture du bundle jetable : champs, 50 entités reprojetées en WGS 84, CRS EPSG:2154, colonne d’identité, mapping par défaut', async () => {
    expect(chargeur).not.toHaveBeenCalled();
    await lire();
    expect(etat.erreurLecture()).toBe('');
    expect(etat.crs()).toBe('EPSG:2154');
    expect(etat.fields().map((f) => f.name)).toEqual(['idcar_200m', 'ind', 'men', 'lcog_geo']);
    expect(etat.features()).toHaveLength(50);
    expect(etat.features()[0].properties).toEqual({ idcar_200m: 'ESSAI_LOT6_0001', ind: 10, men: 4, lcog_geo: '75056' });
    const [lng, lat] = etat.features()[0].geometry[0][0];
    expect(lng).toBeCloseTo(2.33, 1);
    expect(lat).toBeCloseTo(48.86, 1);
    expect(etat.bundle()?.fileName).toBe('carreaux-essai');
    expect(etat.bundle()?.prj).toContain('Lambert_Conformal_Conic');
    expect(etat.idColumn()).toBe('idcar_200m');
    expect(etat.resolution()).toBe('200m');
    expect(etat.millesime()).toBe('2021');
    expect(etat.mappings()).toEqual([
      { source: 'idcar_200m', target: '' }, { source: 'ind', target: '' }, { source: 'men', target: '' }, { source: 'lcog_geo', target: '' },
    ]);
    expect(espaces(etat.lecture()!.libelle)).toBe('✓ 50 features prêtes');
    expect(etat.lecture()).toMatchObject({ lus: 50, total: 50 });
    expect(etat.lectureEnCours()).toBe(false);
    // proj4 : chargé UNE fois, au premier fichier lu — jamais à la construction de l'écran.
    expect(chargeur).toHaveBeenCalledTimes(1);
    expect(etat.etape()).toBe(1);
    await new Promise((r) => setTimeout(r, 650));
    expect(etat.etape()).toBe(2);
  });

  it('millésime et résolution repris du nom du fichier (`(\\d{4})`, `1km`)', async () => {
    const renommer = (f: File) => new File([f], f.name.replace('carreaux-essai', 'Filosofi2019_carreaux_1km'));
    await etat.lire(fichiersEssai(3).map(renommer));
    expect(etat.millesime()).toBe('2019');
    expect(etat.resolution()).toBe('1km');
  });

  it('fichiers manquants : messages de React, rien lu, proj4 non chargé', async () => {
    const [shp, shx, dbf] = fichiersEssai(3);
    await etat.lire([dbf, shx]);
    expect(etat.erreurLecture()).toBe('Fichier .shp manquant. Sélectionnez les 4 fichiers du Shapefile (.shp, .dbf, .prj, .shx).');
    await etat.lire([shp, shx]);
    expect(etat.erreurLecture()).toBe('Fichier .dbf manquant (attributs). Sélectionnez au minimum .shp et .dbf.');
    expect(chargeur).not.toHaveBeenCalled();
    expect(etat.lectureEnCours()).toBe(false);
  });

  it('nombres d’entités différents (.shp de 3, .dbf de 4) : « Incohérence: … » de React', async () => {
    const [shp] = fichiersEssai(3);
    const dbf = fichiersEssai(4)[2];
    await etat.lire([shp, dbf]);
    expect(etat.erreurLecture()).toBe('Incohérence: 3 géométries vs 4 enregistrements DBF');
    expect(etat.features()).toEqual([]);
  });

  it('envoi de 2 500 entités : 3 POST SÉQUENTIELS (le suivant après la réponse du précédent), corps exacts, puis `register`', async () => {
    await lire(2500);
    etat.inclure(3, false); // lcog_geo exclue
    etat.renommer(1, 'population'); // ind → population
    const fin = etat.importer();
    expect(etat.importEnCours()).toBe(true);
    expect(etat.progression()).toEqual({ current: 0, total: 2500 });

    const corps: LigneCarreau[][] = [];
    for (const [i, taille] of [[0, 1000], [1, 1000], [2, 500]] as const) {
      const req = await requete(URL_LOT);
      expect(req.request.method).toBe('POST');
      const rows = (req.request.body as { rows: LigneCarreau[] }).rows;
      expect(Object.keys(req.request.body as object)).toEqual(['rows']);
      expect(rows).toHaveLength(taille);
      corps.push(rows);
      // Rien d'autre ne part tant que ce lot n'a pas répondu.
      await tick(); await tick();
      expect(http.match(URL_LOT)).toHaveLength(0);
      req.flush({ success: true, inserted: taille });
      await tick();
      if (i < 2) expect(etat.progression()).toEqual({ current: (i + 1) * 1000, total: 2500 });
    }
    expect(corps[0][0]).toEqual({
      idcar: 'ESSAI_LOT6_0001', resolution: '200m', millesime: '2021',
      geom_wkt: expect.stringMatching(/^SRID=4326;POLYGON\(\((2\.3\d+ 48\.8\d+,){4}2\.3\d+ 48\.8\d+\)\)$/),
      metadata: { idcar_200m: 'ESSAI_LOT6_0001', population: 10, men: 4 },
    });
    expect(corps[2][499].idcar).toBe('ESSAI_LOT6_2500');

    const reg = await requete(URL_REGISTER);
    expect(etat.phase()).toBe('Enregistrement');
    expect(reg.request.body).toEqual({
      name: 'Carreaux 200m — 2021 (carreaux-essai)', resolution: '200m', millesime: '2021',
      row_count: 2500, columns: ['idcar_200m', 'population', 'men'], filename: 'carreaux-essai',
    });
    reg.flush({ success: true, source_id: 'src-1' });
    await fin;
    expect(etat.termine()).toBe(true);
    expect(etat.importEnCours()).toBe(false);
    expect(etat.erreurImport()).toBe('');
    const lignes = etat.journal().map((l) => espaces(l.message));
    expect(lignes.slice(0, 4)).toEqual([
      'Début de l\'insertion : 2 500 lignes détectées.',
      'Table cible : carreaux_filosofi (resolution=200m, millesime=2021)',
      'Taille des lots : 1000 — 3 lots à envoyer.',
      '',
    ]);
    expect(lignes).toContain('✓ Lot 1/3 inséré (1 000 lignes) — total: 1 000/2 500');
    expect(lignes).toContain('✓ Lot 3/3 inséré (500 lignes) — total: 2 500/2 500');
    expect(lignes).toContain('  Lignes insérées : 2 500 / 2 500');
    expect(lignes.at(-1)).toBe('✓ Source enregistrée (id: src-1)');
    expect(etat.journal().find((l) => l.message === 'RAPPORT FINAL')?.niveau).toBe('rapport');
    expect(etat.journal().find((l) => l.message.startsWith('✓ Lot'))?.niveau).toBe('success');
    expect(etat.journal().every((l) => typeof l.horodatage === 'number')).toBe(true);
  });

  it('sans colonne d’identité : `auto_<rang>` sur tout le fichier, comme React', async () => {
    await lire(1001);
    etat.idColumn.set('');
    const fin = etat.importer();
    const l1 = await requete(URL_LOT);
    expect((l1.request.body as { rows: LigneCarreau[] }).rows[0].idcar).toBe('auto_0');
    l1.flush({ success: true, inserted: 1000 });
    const l2 = await requete(URL_LOT);
    expect((l2.request.body as { rows: LigneCarreau[] }).rows[0].idcar).toBe('auto_1000');
    l2.flush({ success: true, inserted: 1 });
    (await requete(URL_REGISTER)).flush({ success: true, source_id: 'x' });
    await fin;
  });

  it('refus 413 d’un lot : deux demi-lots, l’un APRÈS l’autre ; bilan en erreur (« 1 lot(s) en erreur — … »)', async () => {
    await lire(1000);
    const fin = etat.importer();
    const lot = await requete(URL_LOT);
    lot.flush('<html>413 Request Entity Too Large</html>', { status: 413, statusText: 'Payload Too Large' });
    const d1 = await requete(URL_LOT);
    expect((d1.request.body as { rows: LigneCarreau[] }).rows).toHaveLength(500);
    expect((d1.request.body as { rows: LigneCarreau[] }).rows[0].idcar).toBe('ESSAI_LOT6_0001');
    d1.flush({ success: true, inserted: 500 });
    const d2 = await requete(URL_LOT);
    expect((d2.request.body as { rows: LigneCarreau[] }).rows[0].idcar).toBe('ESSAI_LOT6_0501');
    d2.flush({ success: false, error: 'boom' }, { status: 500, statusText: 'Erreur' });
    (await requete(URL_REGISTER)).flush({ success: true, source_id: 'x' });
    await fin;
    const lignes = etat.journal().map((l) => espaces(l.message));
    expect(lignes).toContain('✕ Erreur lot 1/1 : HTTP 413 — payload too large');
    expect(lignes).toContain('  Tentative en demi-lots...');
    expect(lignes).toContain('  ✓ Demi-lot inséré (500 lignes)');
    expect(lignes).toContain('  ✕ Demi-lot échoué : boom');
    expect(espaces(etat.erreurImport())).toBe('1 lot(s) en erreur — 500/1 000 insérés');
  });

  it('refus JSON d’un lot (500, `{ success: false, error }`) : journal « ✕ Erreur lot », pas de demi-lots ; rien inséré → pas de `register`', async () => {
    await lire(5);
    const fin = etat.importer();
    (await requete(URL_LOT)).flush({ success: false, error: 'permission denied' }, { status: 500, statusText: 'Erreur' });
    await fin;
    const lignes = etat.journal().map((l) => espaces(l.message));
    expect(lignes).toContain('✕ Erreur lot 1/1 : permission denied');
    expect(lignes).not.toContain('  Tentative en demi-lots...');
    expect(etat.erreurImport()).toBe('1 lot(s) en erreur — 0/5 insérés');
    expect(etat.termine()).toBe(true);
  });

  it('réseau coupé : « ✕ Exception lot 1 : Failed to fetch » ; refus de `register` : « ! Enregistrement source : … » (non bloquant)', async () => {
    await lire(1001);
    const fin = etat.importer();
    (await requete(URL_LOT)).flush({ success: true, inserted: 1000 });
    (await requete(URL_LOT)).error(new ProgressEvent('error'), { status: 0, statusText: '' });
    (await requete(URL_REGISTER)).flush({ success: false, error: 'duplicate key' }, { status: 500, statusText: 'Erreur' });
    await fin;
    const lignes = etat.journal().map((l) => espaces(l.message));
    expect(lignes).toContain('✕ Exception lot 2 : Failed to fetch');
    expect(lignes.at(-1)).toBe('! Enregistrement source : duplicate key');
    expect(etat.journal().at(-1)?.niveau).toBe('error');
  });

  it('destruction pendant l’envoi : le lot en vol se termine, AUCUN lot nouveau ni `register` ne part', async () => {
    await lire(2500);
    const fin = etat.importer();
    const l1 = await requete(URL_LOT);
    injecteur.destroy();
    l1.flush({ success: true, inserted: 1000 });
    for (let i = 0; i < 10; i++) await tick();
    expect(http.match(URL_LOT)).toHaveLength(0);
    expect(http.match(URL_REGISTER)).toHaveLength(0);
    await fin;
  });

  it('chronomètre : une seconde par tic pendant l’envoi, arrêté en fin d’envoi et à la destruction', async () => {
    const poser = vi.spyOn(globalThis, 'setInterval');
    const effacer = vi.spyOn(globalThis, 'clearInterval');
    const dernierChrono = () => {
      const k = poser.mock.calls.map((c) => c[1]).lastIndexOf(1000);
      return poser.mock.results[k].value as unknown;
    };
    await lire(5);
    const fin = etat.importer();
    const chrono = dernierChrono();
    await new Promise((r) => setTimeout(r, 1100));
    expect(etat.ecoule()).toBe(1);
    (await requete(URL_LOT)).flush({ success: true, inserted: 5 });
    (await requete(URL_REGISTER)).flush({ success: true, source_id: 'x' });
    await fin;
    expect(effacer).toHaveBeenCalledWith(chrono);
    // Relancé, puis l'écran détruit pendant l'envoi : l'intervalle est effacé.
    etat.reinitialiser();
    await lire(5);
    const encore = etat.importer();
    const second = dernierChrono();
    expect(second).not.toBe(chrono);
    const lot = await requete(URL_LOT);
    injecteur.destroy();
    expect(effacer).toHaveBeenCalledWith(second);
    lot.flush({ success: true, inserted: 5 });
    await encore;
  }, 15_000);

  it('« Nouvel import » remet l’écran à zéro (étape 1, ni entités ni journal)', async () => {
    await lire(5);
    etat.choisirEtape(3);
    etat.reinitialiser();
    expect(etat.etape()).toBe(1);
    expect(etat.features()).toEqual([]);
    expect(etat.journal()).toEqual([]);
    expect(etat.progression()).toBeNull();
  });
});
