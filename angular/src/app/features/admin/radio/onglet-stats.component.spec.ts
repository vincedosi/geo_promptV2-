import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { RadioAdminApi, type AuditRadio } from './data/radio-admin.api';
import { fmtDate } from './logique/radio';
import { AUDIT_RADIO, HISTORIQUE_RADIO, STATIONS_RADIO, STATS_RADIO } from './testing/radio-donnees.fixture';

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** Même repli des blancs que `texte` (le séparateur de milliers fr-FR est une espace fine insécable). */
const plie = (s: string) => s.replace(/\s+/g, ' ');
const RACINE = '/hote/app/admin/donnees/importer/radio';

/** La VRAIE route `donnees` (sans le garde), sous un préfixe d'hôte, ouverte sur l'onglet Statistiques. */
async function monter() {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), RadioAdminApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [donnees] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`${RACINE}/stats`);
  const f = harness.fixture;
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const stable = async () => {
    f.detectChanges();
    await f.whenStable();
  };
  http.expectOne('/api/radio/stats').flush(STATS_RADIO);
  http.expectOne('/api/radio/imports-history').flush({ imports: HISTORIQUE_RADIO });
  await stable();
  const servir = async (audit: AuditRadio = AUDIT_RADIO) => {
    http.expectOne('/api/radio/audit').flush(audit);
    await stable();
  };
  const onglet = () => el.querySelector('mg-radio-stats')!;
  const nonMatchees = () => [...onglet().querySelectorAll('[data-section="non-matchees"] tbody tr')].map((tr) => texte(tr.querySelector('td')));
  const champ = <T extends HTMLElement>(nom: string) => onglet().querySelector<T>(`[data-${nom}]`)!;
  const choisir = async (nom: string, valeur: string) => {
    const s = champ<HTMLSelectElement>(nom);
    s.value = valeur;
    s.dispatchEvent(new Event('change'));
    await stable();
  };
  const saisir = async (valeur: string) => {
    const c = champ<HTMLInputElement>('recherche-audit');
    c.value = valeur;
    c.dispatchEvent(new Event('input'));
    await stable();
  };
  return { http, stable, servir, onglet, nonMatchees, champ, choisir, saisir, router: TestBed.inject(Router) };
}

describe('Onglet Statistiques de l’écran Radio — audit du matching (lot 6, T17)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('ouverture : UN GET `audit` sans paramètre, « Chargement de l’audit... » jusqu’à la réponse, rien de `stations`', async () => {
    const { http, onglet, stable } = await monter();
    const req = http.expectOne('/api/radio/audit');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    http.expectNone((r) => r.url === '/api/radio/stations');
    expect(texte(onglet().querySelector('[data-chargement]'))).toBe("Chargement de l'audit...");
    req.flush(AUDIT_RADIO);
    await stable();
    expect(onglet().querySelector('[data-chargement]')).toBeNull();
  });

  it('sections dans l’ordre de React : KPI, barre, par catégorie, non matchées, sources, derniers enrichissements', async () => {
    const { onglet, servir } = await monter();
    await servir();
    const ordre = [...onglet().querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'));
    expect(ordre).toEqual(['kpis', 'barre', 'categories', 'non-matchees', 'sources', 'historique']);
    expect([...onglet().querySelectorAll('mg-entete-section')].map((s) => texte(s))).toEqual([
      'Matching par categorie', 'Radios non matchees (3)', 'Derniers enrichissements',
    ]);
  });

  it('KPI : valeurs, sous-titres et teintes de React (73,3 % → avertissement ; non matchées > 0 → danger ; relations en fr-FR) ; barre à 73,3 %', async () => {
    const { onglet, servir } = await monter();
    await servir();
    const kpis = [...onglet().querySelectorAll('[data-kpi]')].map((k) => [
      texte(k.querySelector('[data-libelle]')), texte(k.querySelector('[data-valeur]')), texte(k.querySelector('[data-sous]')),
      k.querySelector('[data-valeur]')!.getAttribute('data-teinte'),
    ]);
    expect(kpis).toEqual([
      ['Radios matchees', '861 / 1175', '73.3%', 'avert'],
      ['Non matchees', '314', '26.7%', 'danger'],
      ['Relations m2m', plie(formaterNombre(569698)), 'emetteur x radio', null],
    ]);
    expect(formaterNombre(569698)).toBe((569698).toLocaleString('fr-FR'));
    expect(onglet().querySelector<HTMLElement>('[data-section="barre"] [data-remplissage]')!.style.width).toBe('73.3%');
  });

  it('KPI : teintes aux seuils (> 80 succès) et « Non matchees » à 0 → succès', async () => {
    const { onglet, servir } = await monter();
    await servir({ ...AUDIT_RADIO, kpis: { pct: 100, total: 10, matchees: 10, relations: 0, non_matchees: 0 } });
    const teintes = [...onglet().querySelectorAll('[data-kpi] [data-valeur]')].map((v) => v.getAttribute('data-teinte'));
    expect(teintes).toEqual(['succes', 'succes', null]);
    expect(texte(onglet().querySelectorAll('[data-kpi] [data-sous]')[1])).toBe('0.0%');
  });

  it('par catégorie : libellés, `matchees/total`, non matchées, `%`, teintes ; un clic filtre les non matchées et le menu, un second clic retire le filtre', async () => {
    const { onglet, servir, nonMatchees, champ, stable } = await monter();
    await servir();
    const lignes = () => [...onglet().querySelectorAll<HTMLElement>('[data-section="categories"] tbody tr')];
    expect(lignes().map((tr) => [...tr.querySelectorAll('td')].slice(0, 4).map((td) => texte(td)))).toEqual([
      ['?', '0/1', '1', '0%'],
      ['C (franchise)', '147/236', '89', '62.3%'],
      ['B (locale comm.)', '166/189', '23', '87.8%'],
      ['P (public)', '53/53', '0', '100%'],
    ]);
    expect(lignes().map((tr) => tr.querySelector('[data-pct]')!.getAttribute('data-teinte'))).toEqual(['danger', 'danger', 'secondaire', 'succes']);
    expect(lignes().map((tr) => tr.querySelector('[data-barre]')!.getAttribute('data-teinte'))).toEqual(['danger', 'danger', 'teal', 'succes']);
    expect(lignes()[1].querySelector<HTMLElement>('[data-barre]')!.style.width).toBe('62.3%');
    expect(nonMatchees()).toEqual(['Europe 2 Nord Picardie', 'Radio Locale B', 'Radio Absente']);
    lignes()[1].click();
    await stable();
    expect(nonMatchees()).toEqual(['Europe 2 Nord Picardie', 'Radio Absente']);
    expect(champ<HTMLSelectElement>('categorie').value).toBe('C');
    expect(lignes()[1].getAttribute('aria-selected')).toBe('true');
    lignes()[1].click();
    await stable();
    expect(nonMatchees()).toHaveLength(3);
    expect(champ<HTMLSelectElement>('categorie').value).toBe('');
  });

  it('non matchées : filtres recherche / catégorie / diagnostic / fréquences, options de React ; lignes et liens externes', async () => {
    const { onglet, servir, nonMatchees, champ, choisir, saisir } = await monter();
    await servir();
    expect([...champ<HTMLSelectElement>('categorie').options].map((o) => [o.value, o.text])).toEqual([
      ['', 'Toutes cat.'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E'], ['P', 'P'],
    ]);
    expect([...champ<HTMLSelectElement>('diagnostic').options].map((o) => [o.value, o.text])).toEqual([
      ['', 'Tous diagnostics'], ['parent', 'Parent detecte'], ['declinaison', 'Declinaison locale'],
      ['absente', 'Absente sources'], ['aucune', 'Aucune freq FM'],
    ]);
    expect([...champ<HTMLSelectElement>('frequences').options].map((o) => [o.value, o.text])).toEqual([
      ['0', 'Toutes freq'], ['3', '3+ freq FM'], ['5', '5+ freq FM'],
    ]);
    expect(champ<HTMLInputElement>('recherche-audit').placeholder).toBe('Rechercher...');
    const premiere = onglet().querySelector('[data-section="non-matchees"] tbody tr')!;
    expect([...premiere.querySelectorAll('td')].map((td) => texte(td))).toEqual([
      'Europe 2 Nord Picardie', 'C', 'locale', '9', 'Parent detecte: Europe 2', 'freq-radioarcom',
    ]);
    expect(premiere.querySelector('[data-diagnostic]')!.getAttribute('data-teinte')).toBe('teal');
    expect(premiere.querySelector('[data-freq]')!.getAttribute('data-fort')).toBe('true');
    const [freq, arcom] = [...premiere.querySelectorAll<HTMLAnchorElement>('a')];
    expect(freq.getAttribute('href')).toBe('https://www.frequence-radio.com/frequence-europe-2-nord-picardie.html');
    expect(arcom.getAttribute('href')).toBe('https://www.arcom.fr/rechercher?query=Europe%202%20Nord%20Picardie');
    expect([freq, arcom].map((a) => [a.target, a.rel])).toEqual([['_blank', 'noopener noreferrer'], ['_blank', 'noopener noreferrer']]);
    expect(texte(onglet().querySelectorAll('[data-section="non-matchees"] tbody tr')[1].querySelectorAll('td')[2])).toBe('—');

    await saisir('ABS');
    expect(nonMatchees()).toEqual(['Radio Absente']);
    await saisir('');
    await choisir('diagnostic', 'declinaison');
    expect(nonMatchees()).toEqual(['Radio Locale B']);
    await choisir('diagnostic', '');
    await choisir('frequences', '5');
    expect(nonMatchees()).toEqual(['Europe 2 Nord Picardie', 'Radio Absente']);
    await choisir('categorie', 'B');
    expect(nonMatchees()).toEqual([]);
    // Le titre compte TOUTE la liste, pas les lignes filtrées (React : `audit.non_matchees.length`).
    expect(texte(onglet().querySelector('[data-section="non-matchees"] mg-entete-section'))).toBe('Radios non matchees (3)');
  });

  it('sources : part de chaque source dans les relations (`toFixed(1)`), pastille teintée ; arcom = `--info` (le #5b9bd5 de React)', async () => {
    const { onglet, servir } = await monter();
    await servir();
    const sources = [...onglet().querySelectorAll('[data-section="sources"] [data-source]')];
    expect(sources.map((s) => [texte(s), s.getAttribute('data-source')])).toEqual([
      ['arcom 44.4%', 'arcom'], ['fallback-national 4.2%', 'fallback-national'], ['freq-radio 51.5%', 'freq-radio'],
    ]);
  });

  it('derniers enrichissements : date, durée, résumé ou statut teinté ; section absente sans historique', async () => {
    const { onglet, servir } = await monter();
    await servir();
    const lignes = [...onglet().querySelectorAll('[data-section="historique"] [data-enrichissement]')];
    expect(lignes.map((l) => [...l.children].map((c) => texte(c)))).toEqual([
      [fmtDate('2026-09-17T12:47:47.671852+00:00'), '—', 'running'],
      [fmtDate('2026-04-04T07:34:35.555336+00:00'), '13m32s', plie(`P1: ${(546019).toLocaleString('fr-FR')} · P2: ${(23679).toLocaleString('fr-FR')}`)],
    ]);
    expect(lignes.map((l) => l.querySelector('[data-statut]')!.getAttribute('data-teinte'))).toEqual(['avert', 'succes']);
  });

  it('sans historique : pas de section « Derniers enrichissements »', async () => {
    const { onglet, servir } = await monter();
    await servir({ ...AUDIT_RADIO, historique: [] });
    expect(onglet().querySelector('[data-section="historique"]')).toBeNull();
  });

  it('refus de la route : son message, plus de chargement éternel (React restait sur « Chargement de l’audit... »)', async () => {
    const { http, onglet, stable } = await monter();
    http.expectOne('/api/radio/audit').flush({ error: 'function get_radio_audit() does not exist' }, { status: 500, statusText: 'Erreur' });
    await stable();
    expect(onglet().querySelector('[data-chargement]')).toBeNull();
    const erreur = onglet().querySelector('[data-erreur]')!;
    expect(texte(erreur)).toBe('function get_radio_audit() does not exist');
    expect(erreur.getAttribute('role')).toBe('alert');
  });

  it('chaque ouverture RELIT l’audit (React : `useEffect` sur `tab`) ; les filtres vivent au niveau de la page et survivent au détour', async () => {
    const { http, servir, router, stable, choisir, champ, nonMatchees, onglet } = await monter();
    await servir();
    await choisir('diagnostic', 'absente');
    await router.navigateByUrl(`${RACINE}/radios`);
    await stable();
    http.expectOne((r) => r.url === '/api/radio/stations').flush({ stations: STATIONS_RADIO, total: 3, page: 1, limit: 20 });
    await router.navigateByUrl(`${RACINE}/stats`);
    await stable();
    expect(texte(onglet().querySelector('[data-chargement]'))).toBe("Chargement de l'audit...");
    await servir();
    expect(champ<HTMLSelectElement>('diagnostic').value).toBe('absente');
    expect(nonMatchees()).toEqual(['Radio Absente']);
  });

  it('quitter l’onglet pendant la lecture l’annule (lecture seule)', async () => {
    const { http, router, stable } = await monter();
    const req = http.expectOne('/api/radio/audit');
    await router.navigateByUrl(`${RACINE}/import`);
    await stable();
    expect(req.cancelled).toBe(true);
  });
});
