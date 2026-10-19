import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { QualiteApi, type ReponseQualite, type Verification } from './data/qualite.api';
import { QualiteDonneesPage } from './qualite-donnees.page';

const URL = '/api/admin/qualite-donnees';

function indicateur(code: string, verdict: string, p: Record<string, unknown> = {}) {
  return {
    indicator_code: code, label: `Libellé ${code}`, famille: null, data_source: 'iris_column', data_column: code,
    n_source: 100, n_total_source: 400, n_cp: 50, cp_calcules_le: null, part_population: 40,
    age_source_jours: null, n_cp_reference: 6187, verdict, gravite: 0, ...p,
  };
}

function reponse(): ReponseQualite {
  const v = (p: Partial<Verification> & { cle: Verification['cle'] }): Verification => ({
    libelle: `Famille ${p.cle}`, cout: `coût ${p.cle}`, releve: null, calcule_le: null, duree_ms: null, ...p,
  });
  return {
    verifications: [
      v({
        cle: 'indicateurs', calcule_le: '2026-09-14T13:11:10.369Z', duree_ms: 1414,
        releve: {
          n_iris: 49448,
          indicateurs: [
            indicateur('a_ok', 'ok'),
            indicateur('b_vide', 'source_vide', { n_source: 0, part_population: 0, n_cp: 0 }),
            indicateur('c_ok', 'ok', { data_column: null, data_source: 'pollen', n_source: null, age_source_jours: 3 }),
            indicateur('d_partiel', 'partiel'),
          ],
        },
      }),
      v({
        cle: 'fraicheur', calcule_le: '2026-09-14T13:11:25.436Z', duree_ms: 148,
        releve: {
          sources: [
            { table: 'pollen_map_daily', libelle: 'Pollen', derniere_donnee: '2026-09-13', n_lignes: 6004, cadence_attendue_jours: 1, alimentation: 'cron', age_jours: 5 },
            { table: 'iris_bornes_echelle', libelle: 'Bornes', derniere_donnee: null, n_lignes: 37, cadence_attendue_jours: null, alimentation: 'à la main', age_jours: null },
          ],
        },
      }),
      v({ cle: 'invariants' }),
      v({ cle: 'colonnes' }),
    ],
  };
}

describe('QualiteDonneesPage', () => {
  let f: ComponentFixture<QualiteDonneesPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), QualiteApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(QualiteDonneesPage);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    f.detectChanges();
  });

  afterEach(() => http.verify());

  // U+202F (séparateur de milliers fr-FR de `formaterNombre`) ramené à l'espace : attendus lisibles.
  const texte = (n: Element | null) => n?.textContent?.replace(/[  \t\r\n]+/g, ' ').trim() ?? null;
  const famille = (cle: string) => el.querySelector(`[data-verification="${cle}"]`)!;
  const bouton = (cle: string) => famille(cle).querySelector<HTMLButtonElement>('[data-relancer]')!;
  const charge = () => { http.expectOne(URL).flush(reponse()); f.detectChanges(); };

  it('au montage : UN seul GET, aucun POST ; « Chargement des relevés… » pendant', () => {
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('GET');
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement des relevés…');
    req.flush(reponse());
    f.detectChanges();
    expect(el.querySelector('[data-chargement]')).toBeNull();
    expect(el.querySelectorAll('[data-verification]').length).toBe(4);
    expect(el.querySelector('[data-tout-verifier]')).toBeNull();
  });

  it('famille jamais lancée : « jamais lancée », pas « rien à signaler », bouton « Lancer »', () => {
    charge();
    const inv = famille('invariants');
    expect(texte(inv.querySelector('[data-etat-releve]'))).toBe('jamais lancée');
    expect(texte(inv.querySelector('[data-jamais]'))).toBe('Jamais lancée — ce n’est pas « rien à signaler ».');
    expect(texte(bouton('invariants'))).toBe('Lancer');
    expect(inv.querySelector('table')).toBeNull();
  });

  it('famille mesurée : date courte fr-FR + durée, bouton « Relancer », coût annoncé AVANT le clic', () => {
    charge();
    const date = new Date('2026-09-14T13:11:10.369Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    expect(texte(famille('indicateurs').querySelector('[data-etat-releve]'))).toBe(`mesuré le ${date} · 1 414 ms`);
    expect(texte(bouton('indicateurs'))).toBe('Relancer');
    expect(bouton('indicateurs').getAttribute('title')).toBe('Coût : coût indicateurs');
    expect(texte(famille('indicateurs').querySelector('[data-cout]'))).toBe('coût d’une mesure : coût indicateurs');
  });

  it('indicateurs : les problèmes d’abord, puis les « ok », dans leur ordre ; synthèse au pluriel', () => {
    charge();
    const ind = famille('indicateurs');
    expect(texte(ind.querySelector('[data-synthese]'))).toBe('2 indicateurs sur 4 posent problème, et sont proposés à l’utilisateur.');
    const codes = [...ind.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-code'));
    expect(codes).toEqual(['b_vide', 'd_partiel', 'a_ok', 'c_ok']);
    // Vague finale G7 : la teinte de chaque ligne (source vide → danger, partielle → avertissement, ok → aucune).
    const teintes = [...ind.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-teinte'));
    expect(teintes).toEqual(['danger', 'avert', 'neutre', 'neutre']);
    const cellules = (code: string) => [...ind.querySelectorAll(`tr[data-code="${code}"] td`)].map(texte);
    expect(cellules('a_ok')).toEqual(['Libellé a_ok', 'a_ok', '100 · 25 %', '40 %', '50', 'ok']);
    expect(cellules('b_vide')).toEqual(['Libellé b_vide', 'b_vide', '0 · 0 %', '0 %', '0', 'source vide — ne produira jamais rien']);
    expect(cellules('c_ok')).toEqual(['Libellé c_ok', '(pollen)', '—', '40 %', '50 · 3 j', 'ok']);
  });

  it('fraîcheur : périmé au-delà de 3 cadences, « — » sans donnée, et la phrase du contresens cron', () => {
    charge();
    const fr = famille('fraicheur');
    const pollen = fr.querySelector('tr[data-table="pollen_map_daily"]')!;
    expect(pollen.hasAttribute('data-perime')).toBe(true);
    expect([...pollen.querySelectorAll('td')].map(texte)).toEqual(['Pollen pollen_map_daily', '2026-09-13', '5 j', '6 004', 'cron']);
    const bornes = fr.querySelector('tr[data-table="iris_bornes_echelle"]')!;
    expect(bornes.hasAttribute('data-perime')).toBe(false);
    expect([...bornes.querySelectorAll('td')].map(texte)).toEqual(['Bornes iris_bornes_echelle', '—', '—', '37', 'à la main']);
    expect(texte(fr.querySelector('[data-contresens]'))).toContain('signale un cron qui ne tourne pas');
  });

  it('POST d’une famille : corps exact, TOUS les boutons désactivés, « Mesure… » ; relevé remplacé à la réponse', () => {
    charge();
    bouton('invariants').click();
    f.detectChanges();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ verification: 'invariants' });
    expect(texte(bouton('invariants'))).toBe('Mesure…');
    for (const cle of ['indicateurs', 'fraicheur', 'invariants', 'colonnes']) expect(bouton(cle).disabled).toBe(true);

    // Un second clic (forcé) pendant la mesure n'envoie rien.
    bouton('colonnes').disabled = false;
    bouton('colonnes').click();
    http.expectNone((r) => r.method === 'POST' && r.body?.verification === 'colonnes');

    req.flush({
      cle: 'invariants', libelle: 'Famille invariants', calcule_le: '2026-10-07T10:00:00.000Z', duree_ms: 900, persiste: true,
      releve: {
        controles: [
          { cle: 'pop', libelle: 'Population', unite: 'hab.', attendu: 67760552, mesure: 67763352, ecart_absolu: 2800, ecart_relatif: 0.0000413, tolerance: 0.001, n_renseignes: null, pop_couverte: null, ok: true },
          { cle: 'rev', libelle: 'Revenu', unite: '€', attendu: 23097, mesure: 23097, ecart_absolu: 0, ecart_relatif: 0.00001234, tolerance: 0.01, n_renseignes: null, pop_couverte: null, ok: false },
        ],
      },
    });
    f.detectChanges();
    for (const cle of ['indicateurs', 'fraicheur', 'invariants', 'colonnes']) expect(bouton(cle).disabled).toBe(false);
    expect(texte(bouton('invariants'))).toBe('Relancer');
    const inv = famille('invariants');
    expect(inv.querySelector('[data-jamais]')).toBeNull();
    expect(texte(inv.querySelector('[data-synthese]'))).toBe('1 invariant rompu.');
    const lignes = [...inv.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map(texte));
    expect(lignes[0]).toEqual(['Population', '67 760 552 hab.', '67 763 352 hab.', '+2 800 hab.']);
    // Écart nul en unité métier → le pourcentage, à quatre décimales.
    expect(lignes[1]).toEqual(['Revenu', '23 097 €', '23 097 €', '0.0012 %']);
    // Les autres familles ne sont pas relues.
    expect(texte(famille('indicateurs').querySelector('[data-synthese]'))).toContain('2 indicateurs sur 4');
  });

  it('429 : le message du SERVEUR, boutons rendus, aucune relance automatique', () => {
    charge();
    bouton('fraicheur').click();
    http.expectOne(URL).flush(
      { error: 'Trop de requêtes. Réessayez dans quelques instants.', retry_after: 42 },
      { status: 429, statusText: 'Too Many Requests' },
    );
    f.detectChanges();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('Trop de requêtes. Réessayez dans quelques instants.');
    expect(bouton('fraicheur').disabled).toBe(false);
    expect(texte(bouton('fraicheur'))).toBe('Relancer');
    http.expectNone(URL);
  });

  it('vague finale G6 (Q-1) — persiste: false : le relevé s’affiche, avec l’avertissement de Fraîcheur', () => {
    charge();
    bouton('invariants').click();
    http.expectOne(URL).flush({
      cle: 'invariants', libelle: 'Famille invariants', calcule_le: '2026-10-07T10:00:00.000Z', duree_ms: 900, persiste: false,
      releve: { controles: [] },
    });
    f.detectChanges();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('Mesure faite, mais elle n’a pas pu être enregistrée : elle sera perdue au rechargement.');
    expect(texte(bouton('invariants'))).toBe('Relancer');
    expect(famille('invariants').querySelector('[data-jamais]')).toBeNull();
  });

  it('persiste: true : aucun avertissement', () => {
    charge();
    bouton('invariants').click();
    http.expectOne(URL).flush({
      cle: 'invariants', libelle: 'Famille invariants', calcule_le: '2026-10-07T10:00:00.000Z', duree_ms: 900, persiste: true,
      releve: { controles: [] },
    });
    f.detectChanges();
    expect(el.querySelector('[data-erreur]')).toBeNull();
  });

  it('POST en échec sans `error` lisible : « HTTP <statut> »', () => {
    charge();
    bouton('colonnes').click();
    http.expectOne(URL).flush('<html>', { status: 502, statusText: 'Bad Gateway' });
    f.detectChanges();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('HTTP 502');
  });

  it('GET en échec : « HTTP <statut> », aucune famille affichée', () => {
    http.expectOne(URL).flush({ error: 'Accès refusé' }, { status: 500, statusText: 'Erreur' });
    f.detectChanges();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('HTTP 500');
    expect(el.querySelectorAll('[data-verification]').length).toBe(0);
  });

  it('colonnes : triées de la moins à la plus couverte ; renseignée ≠ non nulle', () => {
    charge();
    bouton('colonnes').click();
    http.expectOne(URL).flush({
      cle: 'colonnes', libelle: 'Famille colonnes', calcule_le: '2026-10-07T10:00:00.000Z', duree_ms: 1400, persiste: true,
      releve: {
        n_lignes: 1000,
        colonnes: {
          pleine: { renseignes: 1000, non_nuls: 0 },
          vide: { renseignes: 0, non_nuls: 0 },
          moitie: { renseignes: 300, non_nuls: 250 },
        },
      },
    });
    f.detectChanges();
    const col = famille('colonnes');
    expect(texte(col.querySelector('[data-synthese]'))).toBe('1 colonne(s) entièrement vide(s) sur 3, mesurées sur 1 000 IRIS.');
    const lignes = [...col.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map(texte));
    expect(lignes).toEqual([
      ['vide', '0', '0', '0 %'],
      ['moitie', '300', '250', '30 %'],
      ['pleine', '1 000', '0', '100 %'],
    ]);
    // Fond rouge : colonne entièrement vide seulement ; couverture < 50 % : texte orange (page.tsx:426-435).
    const rangs = col.querySelectorAll('tbody tr');
    expect(rangs[0].getAttribute('data-teinte')).toBe('danger');
    expect(rangs[1].hasAttribute('data-teinte')).toBe(false);
    expect([...rangs].map((r) => r.querySelector('[data-couverture]')!.classList.contains('c-avert'))).toEqual([false, true, false]);
    expect(rangs[0].querySelector('[data-couverture]')!.classList.contains('c-danger')).toBe(true);
  });
});
