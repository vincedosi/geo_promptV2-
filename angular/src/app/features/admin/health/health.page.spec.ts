import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import type { HealthResponse } from '../logique/types/admin';
import { FraicheurApi } from './data/fraicheur.api';
import { HealthApi } from './data/health.api';
import { HealthPage } from './health.page';

/** Réponse factice du brief : 2 OK, 1 WARN, 1 ERROR, 3 tables. */
function reponse(): HealthResponse {
  return {
    success: true,
    status: 'ERROR',
    summary: '1 erreur(s) critique(s) — corrige les problemes ci-dessous',
    checks: [
      { name: 'NEXT_PUBLIC_SUPABASE_URL', status: 'OK', value: 'https://x...', message: 'URL configuree' },
      { name: 'ORS_API_KEY', status: 'WARN', value: '(vide)', message: 'MANQUANT' },
      { name: 'SUPABASE_CONNEXION', status: 'OK', message: 'Connecte a Supabase — 4 organisation(s) trouvee(s)' },
      { name: 'TABLE_PROFILES', status: 'ERROR', message: 'Table "profiles" inaccessible' },
    ],
    database: {
      total_tables: 3,
      total_rows: 3415817,
      total_size: '6.25 GB',
      total_size_bytes: 6710886400,
      db_size: '6.27 GB',
      db_size_bytes: 6732387287,
      tables: [
        { table_name: 'carreaux_filosofi', row_count: 2324577, total_size: '3.12 GB', total_size_bytes: 1, table_size: '2.53 GB', indexes_size: '601 MB' },
        { table_name: 'iris', row_count: 49448, total_size: '209 MB', total_size_bytes: 1, table_size: '88.1 MB', indexes_size: '121 MB' },
        { table_name: 'profiles', row_count: 5, total_size: '48.0 KB', total_size_bytes: 1, table_size: '8.00 KB', indexes_size: '40.0 KB' },
      ],
    },
    timestamp: '2026-10-07T11:00:00.000Z',
  };
}

describe('HealthPage', () => {
  let f: ComponentFixture<HealthPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), HealthApi, FraicheurApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(HealthPage);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    f.detectChanges();
  });

  afterEach(() => http.verify());

  // Espaces ASCII seulement : `\s` avalerait l'espace fine insécable (U+202F) de `fr-FR`.
  const texte = (sel: string) => el.querySelector(sel)?.textContent?.replace(/[ \t\r\n]+/g, ' ').trim() ?? null;
  const bouton = () => el.querySelector<HTMLButtonElement>('[data-retester]')!;

  it('pendant la lecture : aucune pastille, « Diagnostic en cours... », bouton désactivé, 6 + 1 + 3 squelettes', () => {
    const req = http.expectOne('/api/admin/health');
    expect(el.querySelector('[data-statut-global]')).toBeNull();
    expect(texte('[data-resume]')).toBe('Diagnostic en cours...');
    expect(bouton().disabled).toBe(true);
    expect(el.querySelectorAll('[data-section="env"] [data-squelette]').length).toBe(6);
    expect(el.querySelectorAll('[data-section="connexion"] [data-squelette]').length).toBe(1);
    expect(el.querySelectorAll('[data-section="tables"] [data-squelette]').length).toBe(3);
    expect(el.querySelector('[data-section="database"]')).toBeNull();
    req.flush(reponse());
  });

  it('chargé : pastille globale, compteurs 2 / 1 / 1, sections dans l’ordre de React', () => {
    http.expectOne('/api/admin/health').flush(reponse());
    f.detectChanges();
    expect(texte('[data-statut-global]')).toBe('ERROR');
    expect(texte('[data-resume]')).toBe('1 erreur(s) critique(s) — corrige les problemes ci-dessous');
    expect(texte('[data-compte="OK"]')).toBe('✓ 2 OK');
    expect(texte('[data-compte="WARN"]')).toBe('! 1 WARN');
    expect(texte('[data-compte="ERROR"]')).toBe('✕ 1 ERROR');
    const titres = [...el.querySelectorAll('[data-section] [data-titre]')].map((t) => t.textContent!.trim());
    expect(titres).toEqual([
      'Variables d\'environnement', 'Connectivité Supabase', 'Tables Supabase', 'Database Overview', 'Build info',
    ]);
    const noms = (s: string) => [...el.querySelectorAll(`[data-section="${s}"] [data-nom]`)].map((n) => n.textContent!.trim());
    expect(noms('env')).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'ORS_API_KEY']);
    expect(noms('connexion')).toEqual(['SUPABASE_CONNEXION']);
    expect(noms('tables')).toEqual(['TABLE_PROFILES']);
    expect(el.querySelector('[data-section="tables"] [data-fix]')).not.toBeNull();
    expect(bouton().disabled).toBe(false);
  });

  it('sans ERROR ni WARN : seul le compteur OK, pas de bandeau // FIX', () => {
    const r = reponse();
    r.status = 'OK';
    r.checks = r.checks.map((c) => ({ ...c, status: 'OK' as const }));
    http.expectOne('/api/admin/health').flush(r);
    f.detectChanges();
    expect(texte('[data-compte="OK"]')).toBe('✓ 4 OK');
    expect(el.querySelector('[data-compte="WARN"]')).toBeNull();
    expect(el.querySelector('[data-compte="ERROR"]')).toBeNull();
    expect(el.querySelector('[data-fix]')).toBeNull();
  });

  it('BORNES_CARREAUX : section « Fraîcheur des données » entre connexion et tables, sortie des variables', () => {
    const r = reponse();
    r.checks.push({ name: 'BORNES_CARREAUX', status: 'OK', message: 'Les bornes décrivent bien la source actuelle' });
    http.expectOne('/api/admin/health').flush(r);
    f.detectChanges();
    const titres = [...el.querySelectorAll('[data-section] [data-titre]')].map((t) => t.textContent!.trim());
    expect(titres.slice(0, 4)).toEqual(['Variables d\'environnement', 'Connectivité Supabase', 'Fraîcheur des données', 'Tables Supabase']);
    expect([...el.querySelectorAll('[data-section="env"] [data-nom]')].map((n) => n.textContent!.trim())).not.toContain('BORNES_CARREAUX');
  });

  it('Database Overview : nombres fr-FR, barre de taille (quota Pro 8 GB), lignes des tables', () => {
    http.expectOne('/api/admin/health').flush(reponse());
    f.detectChanges();
    expect(texte('[data-section="database"] [data-entete-droite]')).toBe(`3 tables · ${formaterNombre(3415817)} lignes`);
    expect(texte('[data-tuile="lignes"]')).toContain(formaterNombre(3415817));
    expect(texte('[data-taille-base]')).toBe('6.27 GB / 8 GB (78.4%)');
    expect(texte('[data-taille-note]')).toBe('! Espace élevé — surveillez la consommation · quota estimé Pro (8 GB)');
    const lignes = [...el.querySelectorAll('[data-section="database"] tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent!.trim()));
    expect(lignes).toEqual([
      ['carreaux_filosofi', formaterNombre(2324577), '3.12 GB', '2.53 GB', '601 MB'],
      ['iris', formaterNombre(49448), '209 MB', '88.1 MB', '121 MB'],
      ['profiles', '5', '48.0 KB', '8.00 KB', '40.0 KB'],
    ]);
    expect(el.querySelector('[data-tailles-na]')).toBeNull();
    expect(el.querySelector('[data-tailles-estimees]')).toBeNull();
  });

  it('quota Free (500 MB) sous 500 Mo ; bandeaux « N/A » et « ~ »', () => {
    const r = reponse();
    r.database!.db_size = '100 MB';
    r.database!.db_size_bytes = 100 * 1024 * 1024;
    r.database!.total_size = 'N/A';
    http.expectOne('/api/admin/health').flush(r);
    f.detectChanges();
    expect(texte('[data-taille-base]')).toBe('100 MB / 500 MB (20.0%)');
    expect(texte('[data-taille-note]')).toBe('✓ Espace suffisant · quota estimé Free (500 MB)');
    expect(el.querySelector('[data-tailles-na]')).not.toBeNull();
  });

  it('erreur HTTP : message d’erreur, aucune pastille, « Impossible de récupérer les données »', () => {
    http.expectOne('/api/admin/health').flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    f.detectChanges();
    expect(el.querySelector('[data-statut-global]')).toBeNull();
    expect(texte('[data-resume]')).toBe('Erreur de connexion au serveur');
    expect(texte('[data-section="env"] [data-vide]')).toBe('Impossible de récupérer les données');
    expect(el.querySelector('[data-section="database"]')).toBeNull();
    expect(texte('[data-checked]')).toBe('—');
    expect(bouton().disabled).toBe(false);
  });

  it('« Re-tester » relance UNE lecture ; aucune tant que la première est en vol', () => {
    http.expectOne('/api/admin/health').flush(reponse());
    f.detectChanges();
    bouton().click();
    f.detectChanges();
    const seconde = http.expectOne('/api/admin/health');
    expect(bouton().disabled).toBe(true);
    // Pendant le re-test, la pastille, les compteurs et Database Overview disparaissent (page.tsx:208,285,422).
    expect(el.querySelector('[data-statut-global]')).toBeNull();
    expect(el.querySelector('[data-compte="OK"]')).toBeNull();
    expect(el.querySelector('[data-section="database"]')).toBeNull();
    // Un clic (ou un appel) pendant la lecture ne part pas.
    bouton().click();
    f.componentInstance.relire();
    http.expectNone('/api/admin/health');
    seconde.flush(reponse());
    f.detectChanges();
    expect(bouton().disabled).toBe(false);
  });

  it('onglet « Fraîcheur données » : sous-titre de React, UN GET du relevé, aucun POST ; rôles d’onglets complets', () => {
    http.expectOne('/api/admin/health').flush(reponse());
    f.detectChanges();
    const onglets = [...el.querySelectorAll<HTMLButtonElement>('[data-onglet]')];
    expect(onglets.map((o) => o.textContent!.trim())).toEqual(['Diagnostic système', 'Fraîcheur données']);
    // Un onglet non ouvert ne lit rien.
    http.expectNone('/api/admin/fraicheur-donnees');
    onglets[1].click();
    f.detectChanges();
    expect(f.componentInstance.onglet()).toBe('fraicheur');
    expect(texte('[data-sous-titre]')).toBe('D’où vient chaque donnée, comment elle entre, et de quand elle date');
    const req = http.expectOne('/api/admin/fraicheur-donnees');
    expect(req.request.method).toBe('GET');
    req.flush({ sources: [], mesureLe: null, dureeMs: null });
    f.detectChanges();
    expect(el.querySelector('mg-fraicheur')).not.toBeNull();
    expect(el.querySelector<HTMLElement>('#health-panneau-systeme')!.hidden).toBe(true);
    for (const o of onglets) {
      const panneau = el.querySelector(`#${o.getAttribute('aria-controls')}`)!;
      expect(panneau.getAttribute('role')).toBe('tabpanel');
      expect(panneau.getAttribute('aria-labelledby')).toBe(o.id);
    }
    http.expectNone('/api/admin/health');
  });

  it('aller-retour Système ↔ Fraîcheur deux fois : toujours UN seul GET du relevé (cache d’écran)', () => {
    http.expectOne('/api/admin/health').flush(reponse());
    f.detectChanges();
    const onglets = [...el.querySelectorAll<HTMLButtonElement>('[data-onglet]')];
    onglets[1].click();
    f.detectChanges();
    http.expectOne('/api/admin/fraicheur-donnees').flush({ sources: [], mesureLe: null, dureeMs: null });
    for (let i = 0; i < 2; i++) {
      onglets[0].click();
      f.detectChanges();
      expect(el.querySelector('[data-section="env"]')).not.toBeNull();
      onglets[1].click();
      f.detectChanges();
    }
    http.expectNone('/api/admin/fraicheur-donnees');
    http.expectNone('/api/admin/health');
  });

  it('build info : version 7.19.0', () => {
    http.expectOne('/api/admin/health').flush(reponse());
    f.detectChanges();
    expect(texte('[data-section="build"]')).toContain('v7.19.0');
    expect(texte('[data-section="build"]')).toContain('2026-04-28');
  });
});
