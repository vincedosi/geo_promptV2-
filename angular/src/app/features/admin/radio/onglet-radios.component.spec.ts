import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { RadioAdminApi, type StationRadio } from './data/radio-admin.api';
import { AUDIT_RADIO, HISTORIQUE_RADIO, STATIONS_RADIO, STATS_RADIO } from './testing/radio-donnees.fixture';

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const RACINE = '/hote/app/admin/donnees/importer/radio';
const estStations = (r: { url: string }) => r.url === '/api/radio/stations';

/** La VRAIE route `donnees` de ROUTES_ADMIN (sans le garde), sous un préfixe d'hôte, ouverte sur l'onglet Radios. */
async function monter(onglet = 'radios') {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), RadioAdminApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [donnees] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`${RACINE}/${onglet}`);
  const f = harness.fixture;
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  const stable = async () => {
    f.detectChanges();
    await f.whenStable();
  };
  /** Les deux lectures de la PAGE (T16), servies. */
  const servirPage = async (stats: object = STATS_RADIO) => {
    http.expectOne('/api/radio/stats').flush(stats);
    http.expectOne('/api/radio/imports-history').flush({ imports: HISTORIQUE_RADIO });
    await stable();
  };
  const requete = (): TestRequest => http.expectOne(estStations);
  const servir = async (req: TestRequest, stations: StationRadio[] = STATIONS_RADIO, total = stations.length) => {
    req.flush({ stations, total, page: 1, limit: 20 });
    await stable();
  };
  const onglet_ = () => el.querySelector('mg-radio-radios')!;
  const recherche = () => onglet_().querySelector<HTMLInputElement>('[data-recherche]')!;
  const filtre = (v: string) => onglet_().querySelector<HTMLButtonElement>(`[data-filtre="${v}"]`)!;
  const lignes = () => [...onglet_().querySelectorAll('tbody tr')];
  const saisir = async (valeur: string) => {
    recherche().value = valeur;
    recherche().dispatchEvent(new Event('input'));
    await stable();
  };
  return { el, http, router, stable, servirPage, requete, servir, onglet: onglet_, recherche, filtre, lignes, saisir };
}

describe('Onglet Radios de l’écran Radio — recherche, filtre, tableau, pagination (lot 6, T17)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('ouverture : UN GET `stations` aux paramètres exacts de React (`page=1&limit=20&sort=freq_desc&filter=all`), rien de l’audit', async () => {
    const { http, requete, servirPage, servir } = await monter();
    await servirPage();
    const req = requete();
    expect(req.request.method).toBe('GET');
    expect(req.request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=all');
    http.expectNone('/api/radio/audit');
    await servir(req);
  });

  it('« Chargement... » pendant la lecture, puis le tableau aux colonnes et cellules de React', async () => {
    const { onglet, requete, servirPage, servir, lignes } = await monter();
    await servirPage();
    const req = requete();
    expect(texte(onglet().querySelector('[data-chargement]'))).toBe('Chargement...');
    await servir(req);
    expect(onglet().querySelector('[data-chargement]')).toBeNull();
    expect([...onglet().querySelectorAll('thead th')].map((t) => texte(t))).toEqual(['Nom', 'Cat.', 'Émetteurs', 'Freq FM', 'Réseau', 'Slug', '']);
    const cellules = lignes().map((tr) => [...tr.querySelectorAll('td')].map((td) => texte(td)));
    expect(cellules).toEqual([
      ['NRJ', 'E', '412', '180', '—', 'nrj', ''],
      ['Europe 2 Nord Picardie', 'C', '0', '9', 'Europe 2', 'europe-2-nord-picard…', 'non matché'],
      ["Radio Fréquence L'Alsace Plus Longue", '—', '3', '0', '—', 'radio-frequence-l-al…', ''],
    ]);
    // Pastille d'émetteurs : succès s'il y en a, danger à 0 ; réseau en teal s'il existe.
    expect(lignes()[0].querySelector('[data-emetteurs]')!.getAttribute('data-teinte')).toBe('succes');
    expect(lignes()[1].querySelector('[data-emetteurs]')!.getAttribute('data-teinte')).toBe('danger');
    expect(lignes()[1].querySelector('[data-reseau]')).not.toBeNull();
    // Lien vers frequence-radio.com : nouvel onglet, `title` = le nom de page complet.
    const lien = lignes()[1].querySelector<HTMLAnchorElement>('[data-slug]')!;
    expect(lien.getAttribute('href')).toBe('https://www.frequence-radio.com/frequence-europe-2-nord-picardie.html');
    expect(lien.getAttribute('target')).toBe('_blank');
    expect(lien.getAttribute('rel')).toBe('noopener noreferrer');
    expect(lien.getAttribute('title')).toBe('frequence-europe-2-nord-picardie.html');
  });

  it('compteur des radios matchées : `radios_matchees / total_radios` (861/1175, 73 %) — React divisait des ÉMETTEURS par des radios (1007 %)', async () => {
    const { onglet, requete, servirPage, servir } = await monter();
    await servirPage();
    await servir(requete());
    expect(texte(onglet().querySelector('[data-compteur]'))).toBe('861/1175 radios matchées (73%)');
  });

  it('sans stats de page, aucun compteur (React : `stats &&`)', async () => {
    const { http, onglet, requete, servir, stable } = await monter();
    http.expectOne('/api/radio/stats').flush('x', { status: 500, statusText: 'Erreur' });
    http.expectOne('/api/radio/imports-history').flush({ imports: [] });
    await stable();
    await servir(requete());
    expect(onglet().querySelector('[data-compteur]')).toBeNull();
  });

  it('recherche à la FRAPPE (pas de validation, pas d’anti-rebond, comme React) : `search` ajouté, page remise à 1 ; la lecture précédente est ANNULÉE', async () => {
    const { requete, servirPage, servir, saisir } = await monter();
    await servirPage();
    await servir(requete());
    await saisir('e');
    const premiere = requete();
    expect(premiere.request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=all&search=e');
    await saisir('eu');
    // Écart voulu : React laissait les deux réponses arriver dans le désordre (la plus lente gagnait).
    expect(premiere.cancelled).toBe(true);
    const seconde = requete();
    expect(seconde.request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=all&search=eu');
    await servir(seconde);
    // Champ vidé : plus de `search` (React : `if (radiosSearch)`).
    await saisir('');
    expect(requete().request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=all');
  });

  it('filtres « Toutes » / « Avec émetteurs » / « Sans émetteurs » : `filter` et page remise à 1, état pressé', async () => {
    const { onglet, requete, servirPage, servir, filtre } = await monter();
    await servirPage();
    await servir(requete(), STATIONS_RADIO, 45);
    expect(['all', 'matched', 'unmatched'].map((v) => [texte(filtre(v)), filtre(v).getAttribute('aria-pressed')])).toEqual([
      ['Toutes', 'true'], ['Avec émetteurs', 'false'], ['Sans émetteurs', 'false'],
    ]);
    // Page 2, puis un filtre : retour page 1.
    onglet().querySelector<HTMLButtonElement>('[data-suivant]')!.click();
    const p2 = requete();
    expect(p2.request.urlWithParams).toBe('/api/radio/stations?page=2&limit=20&sort=freq_desc&filter=all');
    await servir(p2, STATIONS_RADIO, 45);
    filtre('unmatched').click();
    const r = requete();
    expect(r.request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=unmatched');
    await servir(r, STATIONS_RADIO, 45);
    expect(filtre('unmatched').getAttribute('aria-pressed')).toBe('true');
    expect(filtre('unmatched').getAttribute('data-teinte')).toBe('danger');
    filtre('matched').click();
    const m = requete();
    expect(m.request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=matched');
    await servir(m, STATIONS_RADIO, 45);
    expect(filtre('matched').getAttribute('data-teinte')).toBe('succes');
  });

  it('pagination : seulement au-delà de 20 ; « N radios » brut ; Précédent coupé en page 1, Suivant coupé quand `page * 20 >= total`', async () => {
    const { onglet, requete, servirPage, servir } = await monter();
    await servirPage();
    await servir(requete(), STATIONS_RADIO, 1175);
    const pied = () => onglet().querySelector('[data-pagination]')!;
    const prec = () => pied().querySelector<HTMLButtonElement>('[data-precedent]')!;
    const suiv = () => pied().querySelector<HTMLButtonElement>('[data-suivant]')!;
    expect(texte(pied().querySelector('[data-total]'))).toBe('1175 radios');
    expect(texte(pied().querySelector('[data-page]'))).toBe('1');
    expect(prec().disabled).toBe(true);
    expect(suiv().disabled).toBe(false);
    suiv().click();
    await servir(requete(), STATIONS_RADIO, 41);
    expect(texte(pied().querySelector('[data-page]'))).toBe('2');
    expect(prec().disabled).toBe(false);
    suiv().click();
    await servir(requete(), STATIONS_RADIO, 41);
    expect(suiv().disabled).toBe(true); // 3 × 20 ≥ 41
    prec().click();
    const r = requete();
    expect(r.request.urlWithParams).toBe('/api/radio/stations?page=2&limit=20&sort=freq_desc&filter=all');
    await servir(r, STATIONS_RADIO, 41);
  });

  it('20 radios ou moins : aucune pagination', async () => {
    const { onglet, requete, servirPage, servir } = await monter();
    await servirPage();
    await servir(requete(), STATIONS_RADIO, 20);
    expect(onglet().querySelector('[data-pagination]')).toBeNull();
  });

  it('vide sans recherche : « Aucune radio en base » + « Lancer un import » (lien RELATIF vers l’onglet Import) ; vide avec recherche : « Aucune radio trouvée », sans bouton', async () => {
    const { onglet, requete, servirPage, servir, saisir, router, stable, http } = await monter();
    await servirPage();
    await servir(requete(), []);
    expect(texte(onglet().querySelector('[data-vide] .vide-texte'))).toBe('Aucune radio en base');
    expect(texte(onglet().querySelector('[data-lancer-import]'))).toBe('Lancer un import');
    const lien = onglet().querySelector<HTMLAnchorElement>('[data-lancer-import]')!;
    expect(lien.getAttribute('href')).toBe(`${RACINE}/import`);
    await saisir('zzz');
    await servir(requete(), []);
    expect(texte(onglet().querySelector('[data-vide]'))).toBe('Aucune radio trouvée');
    expect(onglet().querySelector('[data-lancer-import]')).toBeNull();
    await saisir('');
    await servir(requete(), []);
    onglet().querySelector<HTMLAnchorElement>('[data-lancer-import]')!.click();
    await stable();
    expect(router.url).toBe(`${RACINE}/import`);
    http.expectNone(estStations);
  });

  it('refus de la route : son message (React restait sur « Aucune radio en base » et proposait un import)', async () => {
    const { onglet, requete, servirPage, stable } = await monter();
    await servirPage();
    requete().flush({ error: 'Lecture des radios impossible.' }, { status: 500, statusText: 'Erreur' });
    await stable();
    expect(texte(onglet().querySelector('[data-erreur]'))).toBe('Lecture des radios impossible.');
    expect(onglet().querySelector('[data-erreur]')!.getAttribute('role')).toBe('alert');
    expect(onglet().querySelector('[data-lancer-import]')).toBeNull();
  });

  it('recherche, filtre et page vivent au niveau de la PAGE (React) : ils survivent à un passage par un autre onglet, et l’onglet RELIT à chaque retour', async () => {
    const { requete, servirPage, servir, saisir, router, stable, recherche, filtre, http } = await monter();
    await servirPage();
    await servir(requete(), STATIONS_RADIO, 45);
    filtre('matched').click();
    await servir(requete(), STATIONS_RADIO, 45);
    await saisir('eu');
    await servir(requete(), STATIONS_RADIO, 45);
    await router.navigateByUrl(`${RACINE}/stats`);
    await stable();
    http.expectOne('/api/radio/audit').flush(AUDIT_RADIO);
    await router.navigateByUrl(`${RACINE}/radios`);
    await stable();
    const retour = requete();
    expect(retour.request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=matched&search=eu');
    await servir(retour, STATIONS_RADIO, 45);
    expect(recherche().value).toBe('eu');
    expect(filtre('matched').getAttribute('aria-pressed')).toBe('true');
  });

  it('quitter l’onglet pendant la lecture l’annule (lecture seule)', async () => {
    const { requete, servirPage, router, stable, http } = await monter();
    await servirPage();
    const req = requete();
    await router.navigateByUrl(`${RACINE}/import`);
    await stable();
    expect(req.cancelled).toBe(true);
    http.expectNone(estStations);
  });
});
