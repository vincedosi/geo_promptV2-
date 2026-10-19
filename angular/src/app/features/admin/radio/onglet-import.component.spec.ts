import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { RadioAdminApi, type ImportRadio } from './data/radio-admin.api';
import { daysAgo, fmtDate } from './logique/radio';
import { DERNIERE_MAJ, HISTORIQUE_RADIO, STATS_RADIO } from './testing/radio-donnees.fixture';
import { FLUX_RADIO_ANFR, FLUX_RADIO_ARCOM, FLUX_RADIO_ODS } from './testing/radio-flux.fixture';
import { ImportGeoApi } from '../carreaux-import/data/import-geo.api';
import { doublerDialog, texte } from '../testing/dom';

/** La VRAIE route `donnees` (sans le garde), sous un préfixe d'hôte ; notifications à la racine (C7 : le cadre). */
async function monter() {
  doublerDialog();
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, RadioAdminApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [donnees, { path: 'ailleurs', children: [] }] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/hote/app/admin/donnees/importer/radio');
  const f = harness.fixture;
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const notifications = TestBed.inject(NotificationsService);
  const stable = async () => {
    f.detectChanges();
    await f.whenStable();
  };
  const servir = async (imports: ImportRadio[] = HISTORIQUE_RADIO, stats: object = STATS_RADIO) => {
    http.expectOne('/api/radio/stats').flush(stats);
    http.expectOne('/api/radio/imports-history').flush({ imports });
    await stable();
  };
  /** Le début d'un flux, jusqu'à la fin de la ligne qui contient `jusqua`. */
  const morceau = async (req: TestRequest, flux: string, jusqua: string) => {
    const i = flux.indexOf(jusqua);
    expect(i, jusqua).toBeGreaterThanOrEqual(0);
    const bout = flux.indexOf('\n', i) + 1;
    req.event({ type: HttpEventType.DownloadProgress, loaded: bout, partialText: flux.slice(0, bout) });
    await stable();
  };
  const carte = (c: string) => el.querySelector(`[data-carte="${c}"]`)!;
  const bouton = (c: string, b = 'lancer') => carte(c).querySelector<HTMLButtonElement>(`[data-${b}]`)!;
  const journal = () => [...el.querySelectorAll('[data-terminal] > div')].map((d) => texte(d));
  const notes = () => notifications.notifications().map((n) => [n.variante, n.titre, n.message ?? null]);
  const progression = () => el.querySelector('mg-progression-import');
  const relectures = async () => {
    http.expectOne('/api/radio/stats').flush(STATS_RADIO);
    http.expectOne('/api/radio/imports-history').flush({ imports: HISTORIQUE_RADIO });
    await stable();
  };
  return {
    el, http, stable, servir, morceau, carte, bouton, journal, notes, progression, relectures,
    router: TestBed.inject(Router),
  };
}

describe('Onglet Import de l’écran Radio — cartes, journal, historique, zone dangereuse (lot 6, T16)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('cartes d’action aux textes de React (`page.tsx:371-457`) : « — » et « Aucun import » avant les stats, puis les chiffres BRUTS', async () => {
    const { el, carte, bouton, servir } = await monter();
    expect(texte(carte('anfr').querySelector('[data-titre]'))).toBe('Import ANFR');
    expect(texte(carte('anfr').querySelector('[data-description]'))).toBe('Télécharger et importer les émetteurs depuis data.gouv.fr (~64 Mo)');
    expect(texte(carte('anfr').querySelector('[data-etat]'))).toBe('Aucun import');
    expect(texte(carte('enrichissement').querySelector('[data-titre]'))).toBe('Enrichissement radios');
    expect(texte(carte('enrichissement').querySelector('[data-description]'))).toBe('Identifier les radios et les associer aux émetteurs');
    expect(texte(carte('enrichissement').querySelector('[data-etat]'))).toBe('—');
    expect(texte(carte('ods').querySelector('[data-titre]'))).toBe('Référentiel Arcom (ODS)');
    expect(texte(carte('ods').querySelector('[data-description]'))).toBe('Importer le fichier officiel Arcom avec les 1 174 radios et leurs fréquences');
    expect(texte(carte('ods').querySelector('[data-etat]'))).toBe('—');
    expect(texte(bouton('anfr'))).toBe('Lancer l\'import ANFR');
    expect(texte(bouton('enrichissement'))).toBe('Lancer l\'enrichissement');
    expect(texte(bouton('ods', 'choisir'))).toBe('Choisir .ods');
    expect(texte(bouton('ods', 'importer'))).toBe('Importer');
    expect(carte('ods').querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe('.ods,.xlsx');
    // Rien d'affiché tant qu'aucun import n'a produit de ligne.
    expect(el.querySelector('mg-journal')).toBeNull();
    await servir();
    const jours = daysAgo(DERNIERE_MAJ);
    const fraicheur = carte('anfr').querySelector<HTMLElement>('[data-etat]')!;
    expect(texte(fraicheur)).toBe(`Dernier import : ${fmtDate(DERNIERE_MAJ)} (${jours}j)`);
    expect(fraicheur.dataset['teinte']).toBe('succes');
    expect(texte(carte('enrichissement').querySelector('[data-etat]'))).toBe('11836 matchés / 12704 total');
    expect(texte(carte('ods').querySelector('[data-etat]'))).toBe('1175 radios en base');
  });

  it('historique : colonnes, date, type en capitales, statut, durée, détails (erreur à 60 car.) ; vide → « Aucun import effectué »', async () => {
    const { el, servir } = await monter();
    await servir();
    const table = el.querySelector('[data-historique] table')!;
    expect([...table.querySelectorAll('th')].map((t) => texte(t))).toEqual(['Date', 'Type', 'Statut', 'Durée', 'Détails', 'Logs']);
    const lignes = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => texte(td)));
    expect(lignes).toEqual([
      [fmtDate(HISTORIQUE_RADIO[0].started_at), 'ANFR', 'success', '155s', '11138 insérés, 926 màj', 'Voir'],
      [fmtDate(HISTORIQUE_RADIO[1].started_at), 'ARCOM', 'running', '—', '0 insérés, 0 màj', 'Voir'],
      [fmtDate(HISTORIQUE_RADIO[2].started_at), 'ARCOM', 'error', '658s', 'Killed manually - process stuck', 'Voir'],
    ]);
    const statuts = [...table.querySelectorAll<HTMLElement>('[data-statut]')].map((s) => s.dataset['teinte']);
    expect(statuts).toEqual(['succes', 'avert', 'danger']);
    expect(table.querySelector('tbody tr:nth-child(3) [data-erreur]')).not.toBeNull();
    expect(texte(el.querySelector('[data-historique] mg-entete-section'))).toBe('Historique des imports');
  });

  it('historique vide : « Aucun import effectué »', async () => {
    const { el, servir } = await monter();
    await servir([]);
    expect(el.querySelector('[data-historique] table')).toBeNull();
    expect(texte(el.querySelector('[data-historique-vide]'))).toBe('Aucun import effectué');
  });

  it('ANFR : POST SANS corps, journal en flux, barre au `percent` de la phase courante, UNE notification à la fin, puis stats + historique relus', async () => {
    const { el, http, servir, morceau, bouton, journal, notes, progression, relectures, stable } = await monter();
    await servir();
    bouton('anfr').click();
    await stable();
    const req = http.expectOne('/api/radio/import-anfr');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    await morceau(req, FLUX_RADIO_ANFR, 'Phase DOWNLOAD démarrée');
    expect(journal()[0]).toBe('▶ Import ANFR lancé...');
    expect(texte(el.querySelector('[data-section-journal] mg-entete-section'))).toBe('Progression');
    // Pendant l'import : les trois actions sont coupées, aux libellés de React.
    expect(texte(bouton('anfr'))).toBe('Import en cours...');
    expect(texte(bouton('enrichissement'))).toBe('En cours...');
    for (const b of [bouton('anfr'), bouton('enrichissement'), bouton('ods', 'choisir'), bouton('ods', 'importer')]) expect(b.disabled).toBe(true);
    // Étape = la `phase` courante ; pas de `percent` encore : barre indéterminée.
    expect(texte(progression())).toContain('DOWNLOAD…');
    expect(progression()!.querySelector('[data-indeterminee]')).not.toBeNull();

    // Fin de la phase DOWNLOAD : un `done` de phase, PAS la fin de l'import (React notifiait à chaque phase).
    await morceau(req, FLUX_RADIO_ANFR, 'Phase DOWNLOAD terminée');
    expect(notes()).toEqual([]);

    // UPSERT en cours : la barre suit le `percent` du flux, le compteur ses lignes.
    await morceau(req, FLUX_RADIO_ANFR, 'Upsert 6000/12750');
    expect(progression()!.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('47');
    expect(texte(progression()).replace(/\s/g, ' ')).toContain('UPSERT — 6 000 lignes traitées');
    expect(journal().at(-1)).toBe('Upsert 6000/12750 (47%)');

    // Fin de phase UPSERT puis REFRESH_VIEW démarré : nouvelle phase, la barre repart indéterminée.
    await morceau(req, FLUX_RADIO_ANFR, 'Phase REFRESH_VIEW démarrée');
    expect(texte(progression())).toContain('REFRESH_VIEW…');
    expect(progression()!.querySelector('[data-indeterminee]')).not.toBeNull();

    req.flush(FLUX_RADIO_ANFR);
    await stable();
    await relectures();
    expect(notes()).toEqual([['success', 'Import terminé', null]]);
    expect(texte(progression())).toContain('✓ Import terminé');
    expect(progression()!.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    expect(texte(progression()!.querySelector('[data-bilan]'))).toBe(
      'Import ANFR terminé : 12750 émetteurs (11640 FM, 1110 DAB+), 120 nouveaux, 12630 modifiés, 68 supprimés, 6 retirés de l\'ANFR mais conservés car liés à des radios',
    );
    expect(journal().length).toBe(1 + FLUX_RADIO_ANFR.trim().split('\n').length);
    expect(texte(bouton('anfr'))).toBe('Lancer l\'import ANFR');
    expect(bouton('anfr').disabled).toBe(false);
  });

  it('enrichissement : POST `crawl-arcom` sans corps, aucun `percent` (barre indéterminée), filtre par niveau avec compteurs', async () => {
    const { el, http, servir, morceau, bouton, journal, notes, progression, relectures, stable } = await monter();
    await servir();
    bouton('enrichissement').click();
    await stable();
    const req = http.expectOne('/api/radio/crawl-arcom');
    expect(req.request.body).toBeNull();
    await morceau(req, FLUX_RADIO_ARCOM, 'Passe 1 terminée');
    expect(journal()[0]).toBe('▶ Enrichissement lancé...');
    expect(progression()!.querySelector('[data-indeterminee]')).not.toBeNull();
    expect(texte(progression())).toContain('PASS_1…');
    const filtres = [...el.querySelectorAll<HTMLButtonElement>('[data-niveau]')];
    expect(filtres.map((b) => texte(b))).toEqual(['INFO (20)', 'WARN (1)', 'ERROR (1)', 'SUCCESS (5)', 'DEBUG']);
    // Masquer WARN retire la ligne d'avertissement, le compteur reste.
    filtres[1].click();
    await stable();
    expect(texte(filtres[1])).toBe('WARN (1)');
    expect(filtres[1].getAttribute('aria-pressed')).toBe('false');
    req.flush(FLUX_RADIO_ARCOM);
    await relectures();
    expect(journal().some((l) => l.includes('[WARN ]'))).toBe(false);
    expect(journal().some((l) => l.includes('[ERROR ]'))).toBe(true);
    expect(notes()).toEqual([['success', 'Import terminé', null]]);
    expect(texte(progression()!.querySelector('[data-bilan]'))).toBe('Enrichissement terminé : 11836/12704 émetteurs matchés (93.2%)');
  });

  it('le filtre du journal survit au détour par l’onglet Radios (vague finale, A7)', async () => {
    const { el, http, servir, morceau, bouton, router, stable, relectures } = await monter();
    await servir();
    bouton('enrichissement').click();
    await stable();
    const req = http.expectOne('/api/radio/crawl-arcom');
    await morceau(req, FLUX_RADIO_ARCOM, 'Passe 1 terminée');
    el.querySelector<HTMLButtonElement>('[data-niveau="warn"]')!.click();
    await stable();
    await router.navigateByUrl('/hote/app/admin/donnees/importer/radio/radios');
    await stable();
    http.expectOne((r) => r.url === '/api/radio/stations').flush({ stations: [], total: 0, page: 1, limit: 20 });
    await router.navigateByUrl('/hote/app/admin/donnees/importer/radio/import');
    await stable();
    expect(el.querySelector('[data-niveau="warn"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('[data-niveau="info"]')!.getAttribute('aria-pressed')).toBe('true');
    req.flush(FLUX_RADIO_ARCOM);
    await relectures();
  });

  it('ODS : « Importer » coupé sans fichier ; multipart au champ `file` ; « Import ODS terminé » ; fichier remis à vide', async () => {
    const { http, servir, carte, bouton, journal, notes, stable, relectures } = await monter();
    await servir();
    expect(bouton('ods', 'importer').disabled).toBe(true);
    const input = carte('ods').querySelector<HTMLInputElement>('input[type="file"]')!;
    const ods = new File(['PK'], 'frequences_radios_fm_dab_essai.ods');
    Object.defineProperty(input, 'files', { value: [ods], configurable: true });
    input.dispatchEvent(new Event('change'));
    await stable();
    expect(bouton('ods', 'importer').disabled).toBe(false);
    bouton('ods', 'importer').click();
    await stable();
    const req = http.expectOne('/api/radio/import-arcom-ods');
    const corps = req.request.body as FormData;
    expect([...corps.keys()]).toEqual(['file']);
    expect((corps.get('file') as File).name).toBe('frequences_radios_fm_dab_essai.ods');
    expect(journal()[0]).toBe('▶ Import ODS : frequences_radios_fm_dab_essai.ods');
    req.flush(FLUX_RADIO_ODS);
    await stable();
    await relectures();
    expect(notes()).toEqual([['success', 'Import ODS terminé', null]]);
    expect(input.value).toBe('');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    await stable();
    expect(bouton('ods', 'importer').disabled).toBe(true);
  });

  it('import refusé (HTTP ≠ 2xx) : `✗ Erreur : <error>` ou `HTTP <code>`, notification « Import échoué », AUCUNE relecture', async () => {
    const { http, servir, bouton, journal, notes, stable } = await monter();
    await servir();
    bouton('anfr').click();
    await stable();
    http.expectOne('/api/radio/import-anfr').flush('{"error":"Un import ANFR est déjà en cours."}', { status: 409, statusText: 'Conflict' });
    await stable();
    expect(journal()).toEqual(['▶ Import ANFR lancé...', '✗ Erreur : Un import ANFR est déjà en cours.']);
    expect(notes()).toEqual([['error', 'Import échoué', 'Un import ANFR est déjà en cours.']]);
    expect(bouton('anfr').disabled).toBe(false);

    bouton('enrichissement').click();
    await stable();
    http.expectOne('/api/radio/crawl-arcom').flush('<html>', { status: 500, statusText: 'Server Error' });
    await stable();
    expect(journal()).toEqual(['▶ Enrichissement lancé...', '✗ Erreur : HTTP 500']);

    // Corps VIDE (`null`) : illisible comme un corps non JSON, donc `HTTP <statut>` (C7 ; avant : « Erreur : 500 »).
    bouton('anfr').click();
    await stable();
    http.expectOne('/api/radio/import-anfr').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await stable();
    expect(journal()).toEqual(['▶ Import ANFR lancé...', '✗ Erreur : HTTP 502']);
    // `afterEach` vérifie qu'aucune relecture n'est partie (React sort avant `fetchStats`).
  });

  it('ODS refusé : `✗ <error>` et « Import ODS échoué » ; réseau coupé : `✗ Failed to fetch`, « Import échoué », puis relecture', async () => {
    const { http, servir, carte, bouton, journal, notes, stable, relectures } = await monter();
    await servir();
    const input = carte('ods').querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.ods')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await stable();
    bouton('ods', 'importer').click();
    await stable();
    http.expectOne('/api/radio/import-arcom-ods').flush('{"error":"Fichier .ods requis (champ \\"file\\")"}', { status: 400, statusText: 'Bad Request' });
    await stable();
    expect(journal()).toEqual(['▶ Import ODS : a.ods', '✗ Fichier .ods requis (champ "file")']);
    expect(notes()).toEqual([['error', 'Import ODS échoué', 'Fichier .ods requis (champ "file")']]);

    bouton('anfr').click();
    await stable();
    http.expectOne('/api/radio/import-anfr').error(new ProgressEvent('error'), { status: 0 });
    await stable();
    expect(journal().at(-1)).toBe('✗ Failed to fetch');
    expect(notes().at(-1)).toEqual(['error', 'Import échoué', 'Failed to fetch']);
    await relectures();
  });

  it('erreur de la route sans niveau : notification « Erreur » ; flux fini sur une erreur → échec nommé ; flux tronqué → interrompu', async () => {
    const { http, servir, bouton, journal, notes, progression, stable, relectures } = await monter();
    await servir();
    bouton('anfr').click();
    await stable();
    let req = http.expectOne('/api/radio/import-anfr');
    req.flush('{"type":"status","level":"info","phase":"INIT","message":"a"}\n{"type":"error","message":"Log creation failed: x"}\n');
    await stable();
    await relectures();
    expect(journal().at(-1)).toBe('Log creation failed: x');
    expect(notes()).toEqual([['error', 'Erreur', 'Log creation failed: x']]);
    expect(texte(progression())).toContain('! Log creation failed: x');

    bouton('anfr').click();
    await stable();
    req = http.expectOne('/api/radio/import-anfr');
    req.flush(FLUX_RADIO_ANFR.slice(0, FLUX_RADIO_ANFR.indexOf('Phase ARCHIVE démarrée')).replace(/[^\n]*$/, ''));
    await stable();
    await relectures();
    expect(journal().at(-1)).toBe('✗ Le flux s’est interrompu avant la fin.');
    expect(texte(progression())).toContain('! Le flux s’est interrompu avant la fin.');
    expect(notes().filter((n) => n[1] === 'Import terminé')).toEqual([]);
  });

  it('« Voir » : le journal passé REMPLACE le journal courant, au format de React ; « Fermer » le retire', async () => {
    const { el, http, servir, journal, progression, stable } = await monter();
    await servir();
    el.querySelector<HTMLButtonElement>('tbody tr:first-child [data-voir]')!.click();
    await stable();
    http.expectOne('/api/radio/import-logs/7d507127-b88e-4dd0-82c5-1b7cd1d5799f').flush({
      import: HISTORIQUE_RADIO[0],
      entries: [
        { timestamp: '2026-09-17T12:49:04.289814+00:00', level: 'info', phase: 'DOWNLOAD', message: 'Phase DOWNLOAD démarrée' },
        { timestamp: '2026-09-17T12:51:27.830293+00:00', level: 'success', phase: 'DOWNLOAD', message: 'Phase DOWNLOAD terminée (2m24s)' },
        { timestamp: '2026-09-17T12:51:39.136526+00:00', level: 'success', phase: 'FINALIZE', message: 'Import ANFR terminé' },
      ],
    });
    await stable();
    expect(texte(el.querySelector('[data-section-journal] mg-entete-section'))).toBe('Logs de l\'import 7d507127');
    expect(journal()).toEqual([
      '[12:49:04] [INFO ] [DOWNLOAD ] Phase DOWNLOAD démarrée',
      '[12:51:27] [SUCCESS] [DOWNLOAD ] Phase DOWNLOAD terminée (2m24s)',
      '[12:51:39] [SUCCESS] [FINALIZE ] Import ANFR terminé',
    ]);
    // Le texte garde les blancs de React (`padEnd`) : `texte()` les replie, le DOM les porte.
    expect(el.querySelector('[data-terminal] > div')!.textContent).toBe('[12:49:04] [INFO   ] [DOWNLOAD    ] Phase DOWNLOAD démarrée');
    expect(progression()).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-fermer]')!.click();
    await stable();
    expect(el.querySelector('[data-section-journal]')).toBeNull();
  });

  it('« Supprimer les émetteurs » : DELETE `{ target, confirm: false }` → comptes dans la confirmation → confirmer → `confirm: true` → « Données supprimées » et stats relues', async () => {
    const { el, http, servir, notes, stable } = await monter();
    await servir();
    el.querySelector<HTMLButtonElement>('[data-supprimer="emetteurs"]')!.click();
    await stable();
    const essai = http.expectOne('/api/radio/data');
    expect(essai.request.method).toBe('DELETE');
    expect(essai.request.body).toEqual({ target: 'emetteurs', confirm: false });
    essai.flush({ dry_run: true, would_delete: { emetteurs: 12704 } });
    await stable();
    const dialogue = el.querySelector('mg-confirmation dialog')!;
    expect(dialogue.hasAttribute('open')).toBe(true);
    expect(texte(dialogue)).toContain('Supprimer les émetteurs');
    expect(texte(dialogue)).toContain('12704 emetteurs seront supprimés. Cette action est irréversible.');
    const confirmer = [...dialogue.querySelectorAll('button')].find((b) => texte(b) === 'Supprimer')!;
    confirmer.click();
    await stable();
    const reel = http.expectOne('/api/radio/data');
    expect(reel.request.method).toBe('DELETE');
    expect(reel.request.body).toEqual({ target: 'emetteurs', confirm: true });
    reel.flush({ success: true, deleted: { emetteurs: 12704 } });
    await stable();
    expect(notes()).toEqual([['success', 'Données supprimées', null]]);
    // React ne relit QUE les stats (`handleDeleteConfirm`, `page.tsx:325`).
    http.expectOne('/api/radio/stats').flush(STATS_RADIO);
    await stable();
    expect(dialogue.hasAttribute('open')).toBe(false);
  });

  it('« Supprimer tout » : titre et comptes de la cible `all` ; ANNULER ne part jamais en `confirm: true`', async () => {
    const { el, http, servir, stable } = await monter();
    await servir();
    el.querySelector<HTMLButtonElement>('[data-supprimer="all"]')!.click();
    await stable();
    const essai = http.expectOne('/api/radio/data');
    expect(essai.request.body).toEqual({ target: 'all', confirm: false });
    essai.flush({ dry_run: true, would_delete: { emetteurs: 12704, radios: 1175, archive: 11836 } });
    await stable();
    const dialogue = el.querySelector('mg-confirmation dialog')!;
    expect(texte(dialogue)).toContain('Supprimer toutes les données radio');
    expect(texte(dialogue)).toContain('12704 emetteurs, 1175 radios, 11836 archive seront supprimés. Cette action est irréversible.');
    [...dialogue.querySelectorAll('button')].find((b) => texte(b) === 'Annuler')!.click();
    await stable();
    expect(dialogue.hasAttribute('open')).toBe(false);
    http.expectNone('/api/radio/data');
  });

  it('suppression refusée : « Erreur suppression » (essai ou confirmation), la confirmation se ferme', async () => {
    const { el, http, servir, notes, stable } = await monter();
    await servir();
    el.querySelector<HTMLButtonElement>('[data-supprimer="emetteurs"]')!.click();
    await stable();
    http.expectOne('/api/radio/data').flush({ error: 'x' }, { status: 403, statusText: 'Forbidden' });
    await stable();
    expect(el.querySelector('mg-confirmation dialog')!.hasAttribute('open')).toBe(false);
    expect(notes()).toEqual([['error', 'Erreur suppression', null]]);

    el.querySelector<HTMLButtonElement>('[data-supprimer="emetteurs"]')!.click();
    await stable();
    http.expectOne('/api/radio/data').flush({ dry_run: true, would_delete: { emetteurs: 12704 } });
    await stable();
    [...el.querySelectorAll('mg-confirmation dialog button')].find((b) => texte(b) === 'Supprimer')!.dispatchEvent(new Event('click'));
    await stable();
    http.expectOne('/api/radio/data').flush({ error: 'x' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(notes().at(-1)).toEqual(['error', 'Erreur suppression', null]);
    expect(el.querySelector('mg-confirmation dialog')!.hasAttribute('open')).toBe(false);
  });

  it('zone dangereuse DÉSACTIVÉE pendant un import (Q-5, écart à React) ; réactivée à la fin', async () => {
    const { el, http, servir, bouton, stable, relectures } = await monter();
    await servir();
    const zone = () => [...el.querySelectorAll<HTMLButtonElement>('[data-supprimer]')];
    expect(zone().map((b) => b.disabled)).toEqual([false, false]);
    bouton('anfr').click();
    await stable();
    expect(zone().map((b) => b.disabled)).toEqual([true, true]);
    zone()[0].click();
    http.expectNone('/api/radio/data');
    http.expectOne('/api/radio/import-anfr').flush(FLUX_RADIO_ANFR);
    await relectures();
    expect(zone().map((b) => b.disabled)).toEqual([false, false]);
  });

  it('un import terminé invalide les résultats gardés des onglets Radios et Statistiques (Q-3)', async () => {
    const { http, servir, bouton, router, stable, relectures } = await monter();
    await servir();
    const RACINE = '/hote/app/admin/donnees/importer/radio';
    await router.navigateByUrl(`${RACINE}/radios`);
    await stable();
    http.expectOne((r) => r.url === '/api/radio/stations').flush({ stations: [], total: 0, page: 1, limit: 20 });
    await router.navigateByUrl(`${RACINE}/import`);
    await stable();
    await router.navigateByUrl(`${RACINE}/radios`);
    await stable();
    http.expectNone((r) => r.url === '/api/radio/stations');
    await router.navigateByUrl(`${RACINE}/import`);
    await stable();
    bouton('enrichissement').click();
    await stable();
    http.expectOne('/api/radio/crawl-arcom').flush(FLUX_RADIO_ARCOM);
    await relectures();
    await router.navigateByUrl(`${RACINE}/radios`);
    await stable();
    http.expectOne((r) => r.url === '/api/radio/stations').flush({ stations: [], total: 0, page: 1, limit: 20 });
  });

  it('quitter l’écran pendant un import : la requête N’EST PAS annulée (C13), sa suite est ignorée', async () => {
    const { http, servir, bouton, router, notes, stable } = await monter();
    await servir();
    bouton('anfr').click();
    await stable();
    const req = http.expectOne('/api/radio/import-anfr');
    await router.navigateByUrl('/hote/app/admin/ailleurs');
    expect(req.cancelled).toBe(false);
    req.flush(FLUX_RADIO_ANFR);
    await stable();
    expect(notes()).toEqual([]);
    // Ni stats ni historique relus pour un écran détruit (`afterEach`).
  });
});
