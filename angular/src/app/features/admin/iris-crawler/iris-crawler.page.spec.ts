import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import { IrisCrawlerApi } from './data/iris-crawler.api';
import { IrisCrawlerPage } from './iris-crawler.page';
import { DEPOT_IRIS_ESSAI, FLUX_IMPORT_IRIS } from './testing/iris-manual-import.fixture';

const URL_DEPOT = '/api/iris-crawler/manual-upload';
const URL_IMPORT = '/api/iris-crawler/manual-import';

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** `formaterNombre` sépare les milliers par une espace insécable : on compare sans elle. */
const espaces = (s: string) => s.replace(/\s/g, ' ');

/** jsdom n'a ni DragEvent ni DataTransfer : un événement portant `dataTransfer.files`. */
function deposer(el: HTMLElement, fichier: File): void {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: [fichier], dropEffect: 'none' } });
  el.querySelector('[data-zone]')!.dispatchEvent(e);
}

const CSV = new File(['IRIS;DEC_MED21\n340320502;21450\n'], 'iris-essai.csv', { type: 'text/csv' });

describe('IrisCrawlerPage — dépôt manuel, correspondance, import NDJSON (lot 6, T15)', () => {
  let f: ComponentFixture<IrisCrawlerPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), IrisCrawlerApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(IrisCrawlerPage);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  afterEach(() => http.verify());

  const journal = () => [...el.querySelectorAll('[data-terminal] > div')].map((d) => espaces(texte(d)));
  const couleurs = () => [...el.querySelectorAll<HTMLElement>('[data-terminal] > div')].map((d) => d.style.color);
  const boutonImport = () => el.querySelector('[data-importer]') as HTMLButtonElement;
  const barre = () => el.querySelector('mg-progression-import [role="progressbar"]');

  async function deposerEtServir(reponse: object = DEPOT_IRIS_ESSAI) {
    deposer(el, CSV);
    await f.whenStable();
    http.expectOne(URL_DEPOT).flush(reponse);
    await f.whenStable();
  }

  async function lancerImport(): Promise<TestRequest> {
    boutonImport().click();
    await f.whenStable();
    return http.expectOne(URL_IMPORT);
  }

  async function morceau(req: TestRequest, jusqua: string) {
    const bout = FLUX_IMPORT_IRIS.indexOf(jusqua);
    req.event({ type: HttpEventType.DownloadProgress, loaded: bout, partialText: FLUX_IMPORT_IRIS.slice(0, bout) });
    await f.whenStable();
  }

  it('au repos : la zone de dépôt aux textes de React, aucun résultat, aucun journal, aucune requête, ni titre ni « geo.prompt »', () => {
    const zone = el.querySelector('[data-zone]')!;
    expect(texte(zone.querySelector('[data-consigne]'))).toBe('GLISSER UN FICHIER CSV / CLIQUER POUR PARCOURIR');
    expect(texte(zone)).toContain('Formats acceptés : .csv, .tsv · Taille max : 50 Mo');
    expect(texte(zone)).toContain('Ex: BASE_TD_FILO_IRIS_2021_DEC.csv · Séparateur auto-détecté (; ou ,)');
    expect((zone.querySelector('input[type="file"]') as HTMLInputElement).accept).toBe('.csv,.tsv');
    // Fond `C.bgElevated` (`--bg-level-2`) et marge `40px 20px` de React (l.189-192).
    expect(zone.classList).toContain('fond-eleve');
    expect((zone as HTMLElement).style.padding).toBe('40px 20px');
    expect(el.querySelector('[data-resultat]')).toBeNull();
    expect(el.querySelector('mg-journal')).toBeNull();
    expect(el.querySelector('mg-progression-import')).toBeNull();
    expect(el.querySelector('h1')).toBeNull();
    expect(el.textContent).not.toContain('prompt');
  });

  it('dépôt : « UPLOAD EN COURS… » et la ligne de React pendant l’envoi, puis le résultat et la correspondance des colonnes core', async () => {
    deposer(el, CSV);
    await f.whenStable();
    expect(texte(el.querySelector('[data-consigne]'))).toBe('UPLOAD EN COURS…');
    expect(journal()).toEqual(['Upload de iris-essai.csv (0.0 Mo)…']);
    http.expectOne(URL_DEPOT).flush(DEPOT_IRIS_ESSAI);
    await f.whenStable();
    expect(texte(el.querySelector('[data-consigne]'))).toBe('GLISSER UN FICHIER CSV / CLIQUER POUR PARCOURIR');
    const entete = [...el.querySelectorAll('[data-resultat] [data-entete] > span')].map((s) => texte(s));
    expect(entete).toEqual(['iris-essai.csv', '5 lignes · 7 colonnes', '5 colonnes IRIS mappées', '0 colonnes JSONB']);
    expect(texte(el.querySelector('[data-titre-correspondance]'))).toBe('COLONNES MAPPÉES → TABLE IRIS');
    // Les colonnes `ignore` (méta géographique) ne sont pas montrées, comme React.
    const puces = [...el.querySelectorAll('[data-correspondance]')].map((p) => [...p.querySelectorAll('span')].map((s) => texte(s)).join(' '));
    expect(puces).toEqual([
      'DEC_MED21 → rev_median', 'DEC_D121 → rev_d1', 'DEC_D921 → rev_d9', 'DEC_GI21 → indice_gini', 'DISP_TP6021 → taux_pauvrete',
    ]);
    expect(texte(boutonImport())).toBe('IMPORTER 5 COLONNES');
    expect(boutonImport().disabled).toBe(false);
    expect(journal()).toEqual(['Upload de iris-essai.csv (0.0 Mo)…', '✓ 5 lignes — 5 colonnes mappées']);
    expect(couleurs()).toEqual(['var(--text-tertiary)', 'var(--success)']);
  });

  it('dépôt : grands nombres au format fr-FR (`toLocaleString(\'fr-FR\')` de React → `formaterNombre`), avertissements en `! …`', async () => {
    await deposerEtServir({ ...DEPOT_IRIS_ESSAI, totalRows: 16045, parseWarnings: ['Too few fields', 'Too many fields'] });
    expect(espaces(texte(el.querySelector('[data-entete] > span:nth-child(2)')))).toBe(espaces(`${formaterNombre(16045)} lignes · 7 colonnes`));
    expect(journal().slice(1)).toEqual([espaces(`✓ ${formaterNombre(16045)} lignes — 5 colonnes mappées`), '! Too few fields', '! Too many fields']);
    expect(couleurs().slice(2)).toEqual(['var(--danger)', 'var(--danger)']);
  });

  it('dépôt refusé : `! <error>` de la route, sinon « Erreur upload » ; réseau coupé : le `String(e)` de React ; aucun résultat', async () => {
    deposer(el, CSV);
    await f.whenStable();
    http.expectOne(URL_DEPOT).flush({ error: 'Seuls les fichiers .csv et .tsv sont acceptés' }, { status: 400, statusText: 'Bad Request' });
    await f.whenStable();
    expect(journal().at(-1)).toBe('! Seuls les fichiers .csv et .tsv sont acceptés');
    expect(couleurs().at(-1)).toBe('var(--danger)');
    expect(el.querySelector('[data-resultat]')).toBeNull();
    expect(texte(el.querySelector('[data-consigne]'))).toBe('GLISSER UN FICHIER CSV / CLIQUER POUR PARCOURIR');

    deposer(el, CSV);
    await f.whenStable();
    // Un nouveau fichier vide le journal, comme `setLogs([])` de React.
    expect(journal()).toEqual(['Upload de iris-essai.csv (0.0 Mo)…']);
    http.expectOne(URL_DEPOT).flush({}, { status: 500, statusText: 'Server Error' });
    await f.whenStable();
    expect(journal().at(-1)).toBe('! Erreur upload');

    deposer(el, CSV);
    await f.whenStable();
    http.expectOne(URL_DEPOT).error(new ProgressEvent('error'), { status: 0 });
    await f.whenStable();
    expect(journal().at(-1)).toBe('! TypeError: Failed to fetch');
  });

  it('import : corps `{ sessionId, irisKeyCol, mapping }` — la correspondance ET la colonne clé tenues par l’écran (celles d’`autoMap`, ignorées comprises)', async () => {
    await deposerEtServir({ ...DEPOT_IRIS_ESSAI, autoMapResult: { ...DEPOT_IRIS_ESSAI.autoMapResult, irisKeyCol: 'CODE_IRIS' } });
    const req = await lancerImport();
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      sessionId: DEPOT_IRIS_ESSAI.sessionId,
      irisKeyCol: 'CODE_IRIS',
      mapping: DEPOT_IRIS_ESSAI.autoMapResult.mapping,
    });
    req.flush(FLUX_IMPORT_IRIS);
    await f.whenStable();
  });

  it('import, flux en morceaux : journal au texte de React, progression nommée puis déterminée par `percent`, compteurs finaux', async () => {
    await deposerEtServir();
    const req = await lancerImport();
    expect(texte(boutonImport())).toBe('IMPORT EN COURS…');
    expect(boutonImport().disabled).toBe(true);
    expect(journal().at(-1)).toBe('Lancement de l\'import…');
    // Début : rien reçu, étape « Préparation », barre INDÉTERMINÉE (aucun pourcentage inventé).
    expect(texte(el.querySelector('mg-progression-import'))).toContain('Préparation…');
    expect(barre()?.hasAttribute('aria-valuenow')).toBe(false);

    // Coupé au milieu de la 4e ligne : seul le premier lot est lu.
    await morceau(req, '"percent":83');
    expect(journal().slice(3)).toEqual([
      '1200 lignes chargées depuis BASE_TD_FILO_IRIS_2021_DEC.csv. Préparation…',
      '1200 lignes préparées (5 colonnes core)…',
      'Batch 1/3 — 42%',
    ]);
    expect(barre()?.getAttribute('aria-valuenow')).toBe('42');
    expect(espaces(texte(el.querySelector('mg-progression-import')))).toContain('Mise à jour des IRIS — 500 lignes traitées');

    req.flush(FLUX_IMPORT_IRIS);
    await f.whenStable();
    expect(journal().slice(5)).toEqual(['Batch 1/3 — 42%', 'Batch 2/3 — 83%', 'Batch 3/3 — 100%', '✓ Import terminé — 1200 lignes traitées']);
    expect(couleurs().at(-1)).toBe('var(--success)');
    expect(texte(boutonImport())).toBe('✓ IMPORT TERMINÉ');
    expect(boutonImport().disabled).toBe(true);
    expect(barre()?.getAttribute('aria-valuenow')).toBe('100');
    expect(texte(el.querySelector('mg-progression-import'))).toContain('✓ Import terminé');
    expect(espaces(texte(el.querySelector('[data-compteurs]')))).toBe(espaces(`${formaterNombre(1200)} IRIS mis à jour · 0 erreur · statut success`));
    expect(el.querySelector('[data-nouveau-fichier]')).not.toBeNull();
  });

  it('« NOUVEAU FICHIER » : l’écran repart vide (résultat, journal, progression), comme React', async () => {
    await deposerEtServir();
    (await lancerImport()).flush(FLUX_IMPORT_IRIS);
    await f.whenStable();
    (el.querySelector('[data-nouveau-fichier]') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el.querySelector('[data-resultat]')).toBeNull();
    expect(el.querySelector('mg-journal')).toBeNull();
    expect(el.querySelector('mg-progression-import')).toBeNull();
  });

  it('import refusé (HTTP ≠ 2xx) : corps relu en TEXTE puis JSON → `! <error>`, sinon `! HTTP <statut>` ; le bouton revient', async () => {
    await deposerEtServir();
    let req = await lancerImport();
    req.flush('{"error":"Non autorisé"}', { status: 403, statusText: 'Forbidden' });
    await f.whenStable();
    expect(journal().at(-1)).toBe('! Non autorisé');
    expect(couleurs().at(-1)).toBe('var(--danger)');
    expect(texte(boutonImport())).toBe('IMPORTER 5 COLONNES');
    expect(boutonImport().disabled).toBe(false);
    expect(texte(el.querySelector('mg-progression-import'))).toContain('! Non autorisé');

    req = await lancerImport();
    req.flush('<html>Bad Gateway</html>', { status: 500, statusText: 'Server Error' });
    await f.whenStable();
    expect(journal().at(-1)).toBe('! HTTP 500');
  });

  it('événement `error` du flux : `! <message>`, la progression échoue sur ce message, sans « interrompu »', async () => {
    await deposerEtServir();
    const req = await lancerImport();
    req.flush('{"type":"error","message":"Session introuvable ou expirée. Ré-uploadez le fichier."}\n');
    await f.whenStable();
    expect(journal().at(-1)).toBe('! Session introuvable ou expirée. Ré-uploadez le fichier.');
    expect(journal().join('\n')).not.toContain('interrompu');
    expect(texte(el.querySelector('mg-progression-import'))).toContain('! Session introuvable ou expirée. Ré-uploadez le fichier.');
    expect(texte(boutonImport())).toBe('IMPORTER 5 COLONNES');
  });

  it('flux tronqué (fin sans `done` ni `error`) : « Le flux s’est interrompu avant la fin. », jamais une barre à 100 %', async () => {
    await deposerEtServir();
    const req = await lancerImport();
    req.flush(FLUX_IMPORT_IRIS.slice(0, FLUX_IMPORT_IRIS.indexOf('{"type":"progress","message":"Batch 3/3')));
    await f.whenStable();
    expect(journal().at(-1)).toBe('! Le flux s’est interrompu avant la fin.');
    expect(texte(el.querySelector('mg-progression-import'))).toContain('! Le flux s’est interrompu avant la fin.');
    expect((el.querySelector('[data-remplissage]') as HTMLElement).style.width).toBe('83%');
    expect(texte(boutonImport())).toBe('IMPORTER 5 COLONNES');
    expect(el.querySelector('[data-nouveau-fichier]')).toBeNull();
  });

  it('destruction pendant l’import : la requête N’EST PAS annulée (C13), la suite du flux est ignorée sans erreur', async () => {
    await deposerEtServir();
    const req = await lancerImport();
    await morceau(req, '"percent":83');
    f.destroy();
    expect(req.cancelled).toBe(false);
    expect(() => req.flush(FLUX_IMPORT_IRIS)).not.toThrow();
  });

  it('destruction pendant le dépôt : l’envoi est annulé (aucune écriture en base, rien à finir)', async () => {
    deposer(el, CSV);
    await f.whenStable();
    const req = http.expectOne(URL_DEPOT);
    f.destroy();
    expect(req.cancelled).toBe(true);
  });

  it('nouveau fichier pendant un import : le flux précédent continue côté serveur, mais ne réécrit plus l’écran', async () => {
    await deposerEtServir();
    const ancien = await lancerImport();
    deposer(el, CSV);
    await f.whenStable();
    expect(ancien.cancelled).toBe(false);
    http.expectOne(URL_DEPOT).flush(DEPOT_IRIS_ESSAI);
    await f.whenStable();
    ancien.flush(FLUX_IMPORT_IRIS);
    await f.whenStable();
    expect(journal()).toEqual(['Upload de iris-essai.csv (0.0 Mo)…', '✓ 5 lignes — 5 colonnes mappées']);
    expect(texte(boutonImport())).toBe('IMPORTER 5 COLONNES');
    expect(el.querySelector('mg-progression-import')).toBeNull();
  });
});
