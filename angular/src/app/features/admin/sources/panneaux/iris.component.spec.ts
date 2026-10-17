import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { SourcesAdminApi } from '../data/sources-admin.api';
import type { RapportSynchroIris, ReponseStatsIris } from '../data/panneaux.types';
import { IrisComponent } from './iris.component';

const STATS = '/api/admin/iris/stats';
const META = '/api/admin/iris/metadata';

/** La réponse RÉELLE du 17/10, réduite à trois départements. */
const REPONSE: ReponseStatsIris = {
  success: true,
  stats: {
    total: 49448, nb_depts: 104, nb_communes: 34989, type_h: 15166, type_a: 830, type_d: 408, type_z: 33044,
    with_geom: 49363, table_size: '88 MB', index_size: '20 MB',
  },
  top_depts: [{ code: '59', nom: 'Nord', nb: 1346 }, { code: '62', nom: 'Pas-de-Calais', nb: 1165 }, { code: '75', nom: 'Paris', nb: 992 }],
  source: {
    name: 'CONTOURS-IRIS-PE — IGN 2025', edition: '2025-01-01',
    provider: "Institut national de l'information géographique et forestière (IGN)", license: 'Licence Ouverte v2.0 (Etalab)',
    format: 'GeoPackage (GPKG), WGS84 / EPSG:4326', coverage: 'France entière (métropole + DOM)', imported_at: '2026-03-21',
    schema: ['code_iris', 'nom_iris', 'code_commune', 'nom_commune', 'code_dept', 'type_iris', 'geom'],
  },
};

const RAPPORT: RapportSynchroIris = {
  synced: false, total_iris: 49133, db_columns: ['population', 'revenu_median', 'pct_cadres'], code_columns: ['population', 'revenu_median', 'pct_ouvriers'],
  missing_in_code: ['pct_cadres'], missing_in_db: ['pct_ouvriers'],
  fill_status: { population: 49133, revenu_median: 30000, pct_cadres: 1000 },
  rpc_status: { correlation: 'dynamique — information_schema (zéro whitelist)', metrics: 'dynamique — information_schema (zéro whitelist)' },
  manual_actions_needed: [
    "Ajouter 'pct_cadres' dans IRIS_DB_COLUMNS (lib/iris-crawler/db-columns.ts)",
    "Colonne 'pct_ouvriers' déclarée dans le code mais absente de la table iris",
  ],
};

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const espaces = (s: string) => s.replace(/\s/g, ' ');
/** Les nœuds texte d'un élément, joints par une espace (Angular retire les blancs ENTRE éléments). */
function mots(e: Element | null | undefined): string {
  if (!e) return '';
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const l: string[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent?.replace(/\s+/g, ' ').trim(); if (t) l.push(t); }
  return l.join(' ');
}

function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

describe('IrisComponent — référentiel IRIS : stats, millésime, PMTiles, suppression, synchronisation (lot 6, T19)', () => {
  let f: ComponentFixture<IrisComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    doublerDialog();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi, NotificationsService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(IrisComponent);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  const stable = () => f.whenStable();
  const bouton = (sel: string) => el.querySelector<HTMLButtonElement>(sel)!;
  const notifications = () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre, n.message ?? '']);
  const confirmations = () => [...el.querySelectorAll('mg-confirmation dialog')];
  const confirmationOuverte = () => confirmations().find((d) => d.hasAttribute('open')) ?? null;

  async function servir(meta: Record<string, string> = { annee: '2025' }) {
    http.expectOne(STATS).flush(REPONSE);
    http.expectOne(META).flush(meta);
    await stable();
  }

  it('création : DEUX lectures ensemble (stats + métadonnées, `Promise.all` de React), et pas une de plus', async () => {
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement des statistiques IRIS...');
    const enAttente = [http.expectOne(STATS), http.expectOne(META)];
    expect(enAttente.map((r) => r.request.method)).toEqual(['GET', 'GET']);
    enAttente[0].flush(REPONSE);
    enAttente[1].flush({ annee: '2025' });
    await stable();
    http.expectNone(() => true);
    expect(el.querySelector('[data-chargement]')).toBeNull();
  });

  it('statistiques : bandeau source, grille, types (pourcentages), top départements, schéma — chiffres fr-FR de React', async () => {
    await servir();
    expect(texte(el.querySelector('[data-source-nom]'))).toBe('CONTOURS-IRIS-PE — IGN 2025');
    expect([...el.querySelectorAll('[data-source-ligne]')].map(texte)).toEqual([
      "Fournisseur: Institut national de l'information géographique et forestière (IGN)",
      'Licence: Licence Ouverte v2.0 (Etalab)',
      'Format: GeoPackage (GPKG), WGS84 / EPSG:4326',
      'Couverture: France entière (métropole + DOM)',
      'Importé le: 2026-03-21',
    ]);
    expect(espaces(texte(el.querySelector('[data-total]')))).toBe('49 448');
    expect([...el.querySelectorAll('[data-grille] [data-case]')].map((c) => espaces(mots(c)))).toEqual([
      'Départements 104', 'Communes 34 989', 'Avec géométrie 49 363', 'Taille table 88 MB',
    ]);
    expect([...el.querySelectorAll('[data-type-iris]')].map((c) => espaces(mots(c)))).toEqual([
      "Z Zone d'activité économique 33 044 (67%)", 'H Habitation 15 166 (31%)', 'A Activité 830 (2%)', 'D Divers 408 (1%)',
    ]);
    expect([...el.querySelectorAll('[data-departement]')].map(mots)).toEqual(['59 Nord 1346', '62 Pas-de-Calais 1165', '75 Paris 992']);
    expect(el.querySelectorAll('[data-colonne]').length).toBe(7);
    expect(texte(el.querySelector('[data-index]'))).toBe('Index: PRIMARY KEY (code_iris) · GIST (geom) · Taille index: 20 MB');
  });

  it('millésime : valeur lue dans les métadonnées ; « Sauvegarder » → POST `{ annee }` PUIS relecture, « ✓ Sauvegardé » 2 s', async () => {
    await servir({ annee: '2024' });
    const champ = el.querySelector<HTMLInputElement>('[data-annee]')!;
    expect(champ.value).toBe('2024');
    champ.value = '2026';
    champ.dispatchEvent(new Event('input'));
    bouton('[data-sauver-annee]').click();
    await stable();
    expect(texte(bouton('[data-sauver-annee]'))).toBe('Enregistrement…');
    const post = http.expectOne((r) => r.url === META && r.method === 'POST');
    expect(post.request.body).toEqual({ annee: '2026' });
    post.flush({ success: true });
    await stable();
    // React n'en lit PAS la réponse (`useIrisAdmin.ts:115`) : ici la valeur enregistrée est relue.
    vi.useFakeTimers();
    http.expectOne((r) => r.url === META && r.method === 'GET').flush({ annee: '2026' });
    f.detectChanges();
    expect(texte(bouton('[data-sauver-annee]'))).toBe('✓ Sauvegardé');
    expect(champ.value).toBe('2026');
    vi.advanceTimersByTime(1999);
    f.detectChanges();
    expect(texte(bouton('[data-sauver-annee]'))).toBe('✓ Sauvegardé');
    vi.advanceTimersByTime(1);
    f.detectChanges();
    expect(texte(bouton('[data-sauver-annee]'))).toBe('Sauvegarder');
  });

  it('millésime en échec (corps refusé) : notification au message de la route, pas de « ✓ », pas de relecture', async () => {
    await servir();
    bouton('[data-sauver-annee]').click();
    await stable();
    http.expectOne((r) => r.url === META && r.method === 'POST').flush({ error: 'annee: Expected string' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    expect(notifications()).toEqual([['error', 'Enregistrement échoué', 'annee: Expected string']]);
    expect(texte(bouton('[data-sauver-annee]'))).toBe('Sauvegarder');
  });

  it('PMTiles : `mg-confirmation` d’abord (AUCUNE requête), puis POST ; succès et refus rendus aux textes de React', async () => {
    await servir();
    bouton('[data-pmtiles]').click();
    await stable();
    http.expectNone('/api/admin/trigger-pmtiles');
    expect(texte(confirmationOuverte())).toContain('Régénérer les PMTiles IRIS');
    (confirmationOuverte()!.querySelector('.confirmer') as HTMLButtonElement).click();
    await stable();
    const r = http.expectOne('/api/admin/trigger-pmtiles');
    expect(r.request.method).toBe('POST');
    r.flush({ success: true, message: 'x', workflow_url: 'https://github.com/o/r/actions/workflows/generate-iris-pmtiles.yml' });
    await stable();
    expect(confirmationOuverte()).toBeNull();
    expect(texte(el.querySelector('[data-message-pmtiles]'))).toBe(
      '✓ Workflow lancé — durée estimée 5-8 min. Suivi : https://github.com/o/r/actions/workflows/generate-iris-pmtiles.yml',
    );
    expect(el.querySelector('[data-message-pmtiles]')!.getAttribute('data-succes')).toBe('true');
    bouton('[data-pmtiles]').click();
    await stable();
    (confirmationOuverte()!.querySelector('.confirmer') as HTMLButtonElement).click();
    await stable();
    http.expectOne('/api/admin/trigger-pmtiles').flush(
      { error: 'Variables manquantes : GITHUB_ACTIONS_TOKEN et GITHUB_REPO requis dans .env.local' }, { status: 500, statusText: 'Server Error' },
    );
    await stable();
    expect(texte(el.querySelector('[data-message-pmtiles]'))).toBe(
      '! Erreur : Variables manquantes : GITHUB_ACTIONS_TOKEN et GITHUB_REPO requis dans .env.local',
    );
  });

  it('PMTiles annulé : aucune requête', async () => {
    await servir();
    bouton('[data-pmtiles]').click();
    await stable();
    (confirmationOuverte()!.querySelector('.annuler') as HTMLButtonElement).click();
    await stable();
    expect(confirmationOuverte()).toBeNull();
    http.expectNone(() => true);
  });

  it('suppression de TOUS les IRIS : `mg-confirmation` au compte exact, puis DELETE ; succès → message et statistiques RELUES', async () => {
    await servir();
    bouton('[data-supprimer-iris]').click();
    await stable();
    http.expectNone('/api/admin/iris/delete');
    expect(espaces(texte(confirmationOuverte()))).toContain('Confirmer la suppression de 49 448 IRIS ?');
    (confirmationOuverte()!.querySelector('.confirmer') as HTMLButtonElement).click();
    await stable();
    const d = http.expectOne('/api/admin/iris/delete');
    expect(d.request.method).toBe('DELETE');
    d.flush({ success: true, deleted: 49448 });
    await stable();
    // React remet `irisStats` à null, et son effet relit aussitôt (`useIrisAdmin.ts:150,163`) : chargement, puis le message.
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement des statistiques IRIS...');
    await servir();
    expect(texte(el.querySelector('[data-message-suppression]'))).toBe('✓ 49448 IRIS supprimés');
    expect(confirmationOuverte()).toBeNull();
  });

  it('suppression refusée : « ! Erreur: … », statistiques gardées, aucune relecture', async () => {
    await servir();
    bouton('[data-supprimer-iris]').click();
    await stable();
    (confirmationOuverte()!.querySelector('.confirmer') as HTMLButtonElement).click();
    await stable();
    http.expectOne('/api/admin/iris/delete').flush({ success: false, error: 'permission denied' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(texte(el.querySelector('[data-message-suppression]'))).toBe('! Erreur: permission denied');
    expect(espaces(texte(el.querySelector('[data-total]')))).toBe('49 448');
  });

  it('synchronisation : POST, « Vérification… » pendant, puis le rapport (statut, actions, RPC, remplissage trié)', async () => {
    await servir();
    bouton('[data-synchroniser]').click();
    await stable();
    expect(texte(bouton('[data-synchroniser]'))).toBe('Vérification…');
    const r = http.expectOne('/api/admin/sync-iris-system');
    expect(r.request.method).toBe('POST');
    r.flush(RAPPORT);
    await stable();
    expect(mots(el.querySelector('[data-statut-synchro]'))).toBe('! Désynchronisation détectée 3 colonnes en base · 3 dans IRIS_DB_COLUMNS');
    expect([...el.querySelectorAll('[data-action-requise]')].map(texte)).toEqual(RAPPORT.manual_actions_needed.map((a) => `› ${a}`));
    expect([...el.querySelectorAll('[data-rpc]')].map(mots)).toEqual([
      'correlation dynamique — information_schema (zéro whitelist)', 'metrics dynamique — information_schema (zéro whitelist)',
    ]);
    expect([...el.querySelectorAll('[data-remplissage]')].map((c) => [espaces(mots(c)), c.getAttribute('data-niveau'), c.getAttribute('data-hors-code')])).toEqual([
      ['population 49 133', 'bon', 'false'],
      ['revenu_median 30 000', 'moyen', 'false'],
      ['pct_cadres 1 000', 'faible', 'true'],
    ]);
  });

  it('synchronisation en échec : « ! <error> » de la route', async () => {
    await servir();
    bouton('[data-synchroniser]').click();
    await stable();
    http.expectOne('/api/admin/sync-iris-system').flush({ error: 'function get_iris_fill_status() does not exist' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(texte(el.querySelector('[data-erreur-synchro]'))).toBe('! function get_iris_fill_status() does not exist');
  });
});
