import { TestBed } from '@angular/core/testing';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ENREGISTRER_FICHIER, nomDeFichier } from '../../../core/http/telecharger';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import type { DataSource } from '../logique/types/admin';
import { RadioAdminApi } from '../radio/data/radio-admin.api';
import { SourcesAdminApi, type StatsSources, type StatsZones } from './data/sources-admin.api';
import { SourcesPage } from './sources.page';

const IMPORT = '2026-10-16T12:05:00.000Z';
/** Date attendue, calculée comme `formatDate` de React (fuseau de la machine de test). */
const DATE = new Date(IMPORT).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function source(p: Partial<DataSource> & { id: string; name: string }): DataSource {
  return {
    type: 'poi', row_count: 104, valid_count: 101, error_count: 6, import_date: IMPORT, status: 'active',
    ...p,
  };
}

const SOURCES: DataSource[] = [
  source({
    id: 'tf4', name: 'Marine nationale — TF4 septembre 2026 — STRIDE', type: 'panneaux', category: 'ooh', regie: 'STRIDE',
    row_count: 133, valid_count: 133, error_count: 0, original_filename: 'PM.xlsx', file_format: 'xlsx',
    organizations: { name: 'Marine nationale', slug: 'marine' },
  }),
  source({
    id: 'cirfa', name: 'CIRFA', category: 'cirfa', original_filename: 'cirfa.csv', file_format: 'csv',
    filter_fields: ['region', 'ville'], organizations: { name: 'Marine nationale', slug: 'marine' },
  }),
  source({ id: 'car', name: 'Filosofi 2021 — Carreaux 200m', type: 'carreaux', category: 'carreaux', row_count: 2298582, valid_count: 2298582, error_count: 0 }),
];

const STATS: StatsSources = {
  success: true,
  ooh: { total: 1253 },
  poi: { total: 105014, by_category: [] },
  transport: { total: 285015, bus: 276390, train: 8258, tram: 142, metro: 225 },
  flux: { total: 1100, cerema: 1100, osm: 0 },
  carreaux: { total: 2324604 },
  iris: { total: 49448, enrichis: 49133 },
};
const RADIO = { total_emetteurs: 12704, emetteurs_fm: 11602, emetteurs_dab: 1102, total_radios: 1175 };
const ZONES: StatsZones = { total_zones: 7, total_iris: 1234, total_cp: 56, nb_workspaces: 2, top_workspaces: [] };

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** Les nœuds texte d'un élément, joints par une espace (Angular retire les blancs ENTRE éléments). */
function mots(e: Element | null | undefined): string {
  if (!e) return '';
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const l: string[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent?.replace(/\s+/g, ' ').trim(); if (t) l.push(t); }
  return l.join(' ');
}
/** `toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable : on compare sans elle. */
const espaces = (s: string) => s.replace(/\s/g, ' ');

/** Polyfill jsdom : `<dialog>` sans showModal/close (patron de `dv360.page.spec.ts`). */
function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

async function monter() {
  doublerDialog();
  const enregistrer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi, RadioAdminApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: ENREGISTRER_FICHIER, useValue: enregistrer },
      provideRouter([{ path: 'hote/app/admin/donnees', children: [{ path: 'sources', component: SourcesPage }] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/hote/app/admin/donnees/sources');
  const f = harness.fixture;
  const el = f.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const stable = async () => { f.detectChanges(); await f.whenStable(); };
  const notifications = () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre, n.message ?? '']);
  /** Les quatre lectures du montage, servies. */
  const servir = async (sources = SOURCES) => {
    http.expectOne('/api/admin/sources').flush({ success: true, sources });
    http.expectOne('/api/admin/sources-stats').flush(STATS);
    http.expectOne('/api/radio/stats').flush(RADIO);
    http.expectOne('/api/admin/custom-geo/stats').flush(ZONES);
    await stable();
  };
  const onglets = () => [...el.querySelectorAll<HTMLButtonElement>('[data-onglets] [role="tab"]')];
  const onglet = (cle: string) => el.querySelector<HTMLButtonElement>(`[data-onglets] [data-onglet="${cle}"]`)!;
  const carte = (id: string) => el.querySelector<HTMLElement>(`[data-source="${id}"]`)!;
  const detail = () => el.querySelector('mg-detail-source');
  const action = (nom: string) => el.querySelector<HTMLButtonElement>(`mg-detail-source [data-action="${nom}"]`)!;
  return { f, el, http, stable, servir, notifications, onglets, onglet, carte, detail, action, enregistrer };
}

describe('SourcesPage — onglets, vue « Toutes », liste et détail d’une source (lot 6, T18)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('montage : QUATRE lectures (sources, stats, radio, zones), aucune de transport-stats ni de campagnes, ni à l’ouverture de l’onglet Transport', async () => {
    const { http, servir, onglet, stable } = await monter();
    // `servir()` exige UNE requête de chaque adresse ; `afterEach` vérifie qu'il n'en reste aucune autre.
    await servir();
    http.expectNone('/api/admin/transport-stats');
    onglet('transport').click();
    await stable();
    // Le panneau Transport arrive en T19 : d'ici là, l'onglet ne lit rien.
    http.expectNone('/api/admin/transport-stats');
    http.expectNone((r) => r.url.startsWith('/api/admin/campaigns'));
  });

  it('en-tête : badges « Admin » et « N sources », sous-titre de React ; pas de titre de page (celui du cadre)', async () => {
    const { el, servir } = await monter();
    await servir();
    expect(el.querySelector('h1')).toBeNull();
    expect([...el.querySelectorAll('[data-entete] [data-badge]')].map(texte)).toEqual(['Admin', '3 sources']);
    expect(texte(el.querySelector('[data-sous-titre]'))).toBe('Gestion des sources de donnees importees — suppression, partage, export');
  });

  it('neuf onglets, libellés de React (`fmtK`), « Toutes » actif ; DSP en attente « … » (campagnes lues par l’onglet DSP, T20)', async () => {
    const { servir, onglets } = await monter();
    expect(onglets()[0].textContent!.trim()).toBe('Toutes (…)');
    await servir();
    expect(onglets().map((o) => o.textContent!.trim())).toEqual([
      'Toutes (2.8M)', 'POI (105k)', 'Carreaux (2.3M)', 'OOH (1k)', 'IRIS (49k)', 'Transport & Flux (286k)', 'Radio (13k)', 'DSP (…)', 'Zones perso',
    ]);
    expect(onglets().map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false']);
  });

  it('tuiles « Toutes » : valeurs et sous-titres de React (OOH = total seul, A6), formatage fr-FR ; tuile cliquée → son onglet', async () => {
    const { el, servir, stable, onglet } = await monter();
    await servir();
    const tuiles = [...el.querySelectorAll('mg-tuiles-sources [data-tuile]')];
    expect(tuiles.map((t) => [t.getAttribute('data-tuile'), texte(t.querySelector('[data-libelle]')), espaces(texte(t.querySelector('[data-valeur]'))), espaces(texte(t.querySelector('[data-sous]')))])).toEqual([
      ['panneaux', 'Panneaux OOH', '1 253', 'panneaux actifs'],
      ['poi', 'POI', '105 014', 'lycées, CIRFA, autres'],
      ['carreaux', 'Carreaux', '2.32M', 'Filosofi 200m'],
      ['iris', 'IRIS', '49 448', '49 133 enrichis'],
      ['transport', 'Transport & Flux', '286 115', 'arrêts + routes'],
      ['radio', 'Radio', '12 704', 'FM 11602 · DAB+ 1102'],
      ['custom_zones', 'Zones perso', '7', '1 234 IRIS · 56 CP résolus'],
    ]);
    (tuiles[3] as HTMLButtonElement).click();
    await stable();
    expect(onglet('iris').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('mg-tuiles-sources')).toBeNull();
    expect(el.querySelector('[data-provisoire]')).not.toBeNull();
  });

  it('liste : données système (IRIS, Transport), bloc Radio, puis les sources importées (badge, lignes, date, espace, fichier)', async () => {
    const { el, servir } = await monter();
    await servir();
    expect([...el.querySelectorAll('[data-systeme]')].map((s) => s.getAttribute('data-systeme'))).toEqual(['iris', 'transport']);
    expect(espaces(mots(el.querySelector('[data-systeme="iris"]')))).toBe('IRIS — Contours géographiques INSEE IRIS 49 448 zones 49 133 enrichies (population) table: iris');
    expect(espaces(mots(el.querySelector('[data-systeme="transport"]')))).toBe(
      'Transport & Flux routier Transport 286 115 entrées 285 015 arrêts bus 276 390 train 8 258 tram 142 1 100 flux routiers tables: poi_france + comptages_routiers',
    );
    expect(mots(el.querySelector('[data-radio]'))).toBe('Radio Radio — Émetteurs FM & DAB+ 11602 émetteurs FM 1102 émetteurs DAB+ 1175 radios identifiées table: emetteurs_radio Gérer →');
    const cartes = [...el.querySelectorAll('[data-source]')];
    expect(cartes.map((c) => c.getAttribute('data-source'))).toEqual(['tf4', 'cirfa', 'car']);
    expect(texte(cartes[0].querySelector('[data-badge-type]'))).toBe('OOH — STRIDE');
    expect(texte(cartes[1].querySelector('[data-badge-type]'))).toBe('POI — cirfa');
    expect(texte(cartes[2].querySelector('[data-badge-type]'))).toBe('Carreaux INSEE');
    expect(espaces(mots(cartes[1].querySelector('[data-meta]')))).toBe(`101 lignes ${espaces(DATE)} Marine nationale cirfa.csv`);
    expect(espaces(mots(cartes[2].querySelector('[data-meta]')))).toMatch(/^2 298 582 lignes .* —$/);
  });

  it('chargement puis liste vide : textes de React', async () => {
    const { el, http, stable } = await monter();
    expect(texte(el.querySelector('[data-chargement-sources]'))).toBe('Chargement...');
    http.expectOne('/api/admin/sources').flush({ success: true, sources: [] });
    http.expectOne('/api/admin/sources-stats').flush(STATS);
    http.expectOne('/api/radio/stats').flush(RADIO);
    http.expectOne('/api/admin/custom-geo/stats').flush(ZONES);
    await stable();
    const vide = el.querySelector('[data-vide]')!;
    expect(vide.firstChild?.textContent?.trim()).toBe('Aucune source de donnees dans cet onglet.');
    expect(vide.querySelector('br')).not.toBeNull();
    expect(texte(vide.querySelector('span'))).toBe('Importez des donnees via Import Universel');
  });

  it('sélection → détail (lecture) ; changer d’onglet VIDE la sélection', async () => {
    const { el, servir, stable, carte, detail, onglet } = await monter();
    await servir();
    expect(detail()).toBeNull();
    carte('cirfa').click();
    await stable();
    expect(carte('cirfa').getAttribute('aria-pressed')).toBe('true');
    const d = detail()!;
    expect(texte(d.querySelector('[data-nom]'))).toBe('CIRFA');
    expect([...d.querySelectorAll('[data-stat]')].map((s) => [...s.children].map((c) => espaces(texte(c))))).toEqual([['Valides', '101'], ['Total', '104'], ['Erreurs', '6']]);
    expect(mots(d.querySelector('[data-info]'))).toBe(`org: Marine nationale fichier: cirfa.csv format: csv date: ${DATE}`);
    expect([...d.querySelectorAll('[data-filtre]')].map(texte)).toEqual(['region', 'ville']);
    expect(mots(d.querySelector('[data-acces]'))).toBe('Propriétaire et partages : page Accès');
    expect(d.querySelector('[data-acces] a')?.getAttribute('href')).toBe('/hote/app/admin/acces');
    expect(d.querySelector('[data-action="reimporter"]')?.getAttribute('href')).toBe('/hote/app/admin/donnees/importer');
    onglet('poi').click();
    await stable();
    onglet('all').click();
    await stable();
    expect(detail()).toBeNull();
    expect(el.querySelector('[aria-pressed="true"][data-source]')).toBeNull();
  });

  it('édition du nom : PATCH `{ name }` (rogné), puis la liste est RELUE et le détail suit', async () => {
    const { el, http, servir, stable, carte, action, detail } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    action('modifier').click();
    await stable();
    const champ = el.querySelector<HTMLInputElement>('mg-detail-source [data-champ-nom]')!;
    expect(champ.value).toBe('CIRFA');
    champ.value = '  CIRFA renommée  ';
    champ.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-sauver-nom]')!.click();
    await stable();
    const patch = http.expectOne('/api/admin/sources/cirfa');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ name: 'CIRFA renommée' });
    patch.flush({ success: true });
    await stable();
    http.expectOne('/api/admin/sources').flush({ success: true, sources: SOURCES.map((s) => (s.id === 'cirfa' ? { ...s, name: 'CIRFA renommée' } : s)) });
    await stable();
    expect(el.querySelector('mg-detail-source [data-champ-nom]')).toBeNull();
    expect(texte(detail()!.querySelector('[data-nom]'))).toBe('CIRFA renommée');
  });

  it('édition : nom vide → aucune requête (React : `Object.keys(updates).length === 0`)', async () => {
    const { el, http, servir, stable, carte, action } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    action('modifier').click();
    await stable();
    const champ = el.querySelector<HTMLInputElement>('mg-detail-source [data-champ-nom]')!;
    champ.value = '   ';
    champ.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-sauver-nom]')!.click();
    await stable();
    http.expectNone('/api/admin/sources/cirfa');
  });

  it('champs filtres : « Modifier » lit `meta-keys`, cases schéma + metadata, « Tout cocher » / « Effacer », PATCH `{ filter_fields }`', async () => {
    const { el, http, servir, stable, carte } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-basculer-filtres]')!.click();
    await stable();
    expect(texte(el.querySelector('mg-detail-source [data-entete-meta]'))).toBe('colonnes metadata ...');
    http.expectOne('/api/admin/sources/cirfa/meta-keys').flush({ success: true, keys: ['code_cirfa', 'telephone'] });
    await stable();
    const cases = () => [...el.querySelectorAll<HTMLInputElement>('mg-detail-source [data-case]')];
    expect(cases().map((c) => [c.getAttribute('data-case'), c.checked])).toEqual([
      ['region', true], ['departement', false], ['ville', true], ['code_postal', false], ['categorie', false], ['sous_categorie', false],
      ['code_cirfa', false], ['telephone', false],
    ]);
    expect(texte(el.querySelector('mg-detail-source [data-entete-meta]'))).toBe('colonnes metadata (2)');
    expect(texte(el.querySelector('mg-detail-source [data-compteur]'))).toBe('2 filtres');
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-effacer]')!.click();
    await stable();
    // React : `n !== 1 ? 's' : ''` — « 0 filtres », « 1 filtre ».
    expect(texte(el.querySelector('mg-detail-source [data-compteur]'))).toBe('0 filtres');
    cases()[6].click();
    cases()[2].click();
    await stable();
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-sauver-filtres]')!.click();
    await stable();
    const patch = http.expectOne('/api/admin/sources/cirfa');
    expect(patch.request.body).toEqual({ filter_fields: ['code_cirfa', 'ville'] });
    patch.flush({ success: true });
    await stable();
    expect([...el.querySelectorAll('mg-detail-source [data-filtre]')].map(texte)).toEqual(['code_cirfa', 'ville']);
    expect(el.querySelector('mg-detail-source [data-editeur-filtres]')).toBeNull();
    // Pas de relecture de la liste : React met la source à jour en place.
    http.expectNone('/api/admin/sources');
  });

  it('« Tout cocher » = colonnes schéma PUIS clés metadata ; « Aucun filtre configure » sans filtre', async () => {
    const { el, http, servir, stable, carte } = await monter();
    await servir();
    carte('tf4').click();
    await stable();
    expect(texte(el.querySelector('mg-detail-source [data-aucun-filtre]'))).toBe('Aucun filtre configure');
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-basculer-filtres]')!.click();
    await stable();
    http.expectOne('/api/admin/sources/tf4/meta-keys').flush({ success: true, keys: [] });
    await stable();
    expect(texte(el.querySelector('mg-detail-source [data-entete-meta]'))).toBe('colonnes metadata (aucune)');
    expect(texte(el.querySelector('mg-detail-source [data-meta-vide]'))).toBe('Pas de cles metadata trouvees');
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-tout-cocher]')!.click();
    await stable();
    expect(texte(el.querySelector('mg-detail-source [data-compteur]'))).toBe('6 filtres');
  });

  it('changer de source REMET l’éditeur à zéro (React gardait l’éditeur et les champs de la source précédente)', async () => {
    const { el, http, servir, stable, carte } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    el.querySelector<HTMLButtonElement>('mg-detail-source [data-basculer-filtres]')!.click();
    await stable();
    http.expectOne('/api/admin/sources/cirfa/meta-keys').flush({ success: true, keys: [] });
    await stable();
    carte('tf4').click();
    await stable();
    expect(el.querySelector('mg-detail-source [data-editeur-filtres]')).toBeNull();
  });

  it('export (C8) : blob par HttpClient, `ENREGISTRER_FICHIER` reçoit la réponse — nom tiré de `Content-Disposition`', async () => {
    const { http, servir, stable, carte, action, enregistrer } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    action('exporter').click();
    await stable();
    const r = http.expectOne('/api/admin/sources/cirfa/export');
    expect(r.request.responseType).toBe('blob');
    r.flush(new Blob(['nom;categorie\n']), { headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="CIRFA_export.csv"' }) });
    await stable();
    expect(enregistrer).toHaveBeenCalledTimes(1);
    const [doc, reponse, repli] = enregistrer.mock.calls[0];
    expect(doc).toBe(document);
    expect(repli).toBe('export.csv');
    expect(nomDeFichier(reponse, repli)).toBe('CIRFA_export.csv');
  });

  it('export en échec : notification, aucun fichier', async () => {
    const { http, servir, stable, carte, action, enregistrer, notifications } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    action('exporter').click();
    await stable();
    http.expectOne('/api/admin/sources/cirfa/export').flush(new Blob(['{"success":false,"error":"Source non trouvee"}']), { status: 404, statusText: 'Not Found' });
    await stable();
    expect(enregistrer).not.toHaveBeenCalled();
    expect(notifications()).toEqual([['error', 'Export échoué', 'HTTP 404']]);
  });

  it('suppression : `mg-confirmation` au texte de React, puis DELETE ; succès → source retirée, détail fermé, « Source supprimée »', async () => {
    const { el, http, servir, stable, carte, action, detail, notifications } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    const dialog = el.querySelector('mg-sources mg-confirmation dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    action('supprimer').click();
    await stable();
    expect(dialog.open).toBe(true);
    expect(texte(dialog)).toContain('Supprimer cette source');
    expect(texte(dialog)).toContain('Cette action supprimera la source et TOUTES ses données associées. Cette action est irréversible.');
    http.expectNone((r) => r.method === 'DELETE');
    const confirmer = dialog.querySelector<HTMLButtonElement>('button.confirmer')!;
    expect(confirmer.textContent!.trim()).toBe('Supprimer');
    confirmer.click();
    await stable();
    expect(texte(action('supprimer'))).toBe('Suppression...');
    const del = http.expectOne((r) => r.method === 'DELETE');
    expect(del.request.url).toBe('/api/admin/sources/cirfa');
    del.flush({ success: true, deleted: { poi: 101, panneaux: 0, carreaux: false, source: true } });
    await stable();
    expect(dialog.open).toBe(false);
    expect(detail()).toBeNull();
    expect([...el.querySelectorAll('[data-source]')].map((c) => c.getAttribute('data-source'))).toEqual(['tf4', 'car']);
    expect(notifications()).toEqual([['success', 'Source supprimée', '']]);
    expect([...el.querySelectorAll('[data-entete] [data-badge]')].map(texte)).toEqual(['Admin', '2 sources']);
  });

  it('suppression refusée 409 (panneaux d’une campagne) : « Suppression échouée » + le texte de la route ; la source reste', async () => {
    const { el, http, servir, stable, carte, action, detail, notifications } = await monter();
    await servir();
    carte('tf4').click();
    await stable();
    action('supprimer').click();
    await stable();
    el.querySelector<HTMLButtonElement>('mg-sources mg-confirmation button.confirmer')!.click();
    await stable();
    const erreur = 'Ces panneaux appartiennent à une campagne : ils ne se suppriment pas depuis leur source. Retirez-les de la campagne en réimportant son plan. La source est conservée.';
    http.expectOne((r) => r.method === 'DELETE').flush({ success: false, error: erreur }, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(notifications()).toEqual([['error', 'Suppression échouée', erreur]]);
    expect((el.querySelector('mg-sources mg-confirmation dialog') as HTMLDialogElement).open).toBe(false);
    expect(detail()).not.toBeNull();
    expect(el.querySelectorAll('[data-source]').length).toBe(3);
  });

  it('suppression : réseau coupé → « Erreur réseau » ; corps sans `error` → « Erreur inconnue »', async () => {
    const { el, http, servir, stable, carte, action, notifications } = await monter();
    await servir();
    carte('cirfa').click();
    await stable();
    const supprimer = async () => {
      action('supprimer').click();
      await stable();
      el.querySelector<HTMLButtonElement>('mg-sources mg-confirmation button.confirmer')!.click();
      await stable();
    };
    await supprimer();
    http.expectOne((r) => r.method === 'DELETE').error(new ProgressEvent('error'));
    await stable();
    await supprimer();
    http.expectOne((r) => r.method === 'DELETE').flush({ success: false }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(notifications()).toEqual([
      ['error', 'Erreur réseau', 'Connexion au serveur impossible'],
      ['error', 'Suppression échouée', 'Erreur inconnue'],
    ]);
  });

  it('onglet Radio : le bloc Radio seul (React ne rendait rien) ; autres onglets : panneau provisoire, sans lecture', async () => {
    const { el, http, servir, stable, onglet } = await monter();
    await servir();
    onglet('radio').click();
    await stable();
    expect(el.querySelector('[data-radio]')).not.toBeNull();
    expect(el.querySelector('[data-source]')).toBeNull();
    for (const cle of ['poi', 'carreaux', 'panneaux', 'iris', 'transport', 'dsp', 'custom_zones']) {
      onglet(cle).click();
      await stable();
      expect(el.querySelector('[data-provisoire]'), cle).not.toBeNull();
    }
    http.expectNone(() => true);
  });

  it('« Gérer → » du bloc Radio est INERTE tant que l’écran Radio n’est pas porté (patron de la barre)', async () => {
    const { el, servir } = await monter();
    await servir();
    const gerer = el.querySelector('[data-radio] [data-gerer]')!;
    expect(gerer.getAttribute('aria-disabled')).toBe('true');
    expect(gerer.getAttribute('title')).toBe('Disponible prochainement');
    expect(gerer.hasAttribute('href')).toBe(false);
  });

  it('carte de données système cliquée → son onglet', async () => {
    const { el, servir, stable, onglet } = await monter();
    await servir();
    el.querySelector<HTMLButtonElement>('[data-systeme="transport"]')!.click();
    await stable();
    expect(onglet('transport').getAttribute('aria-selected')).toBe('true');
  });
});
