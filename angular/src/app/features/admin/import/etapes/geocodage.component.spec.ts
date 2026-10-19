import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ImportPoiService } from '../etat/import-poi.service';
import { GEOCODAGE_ESSAI } from '../testing/geocodage.fixture';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { GeocodageComponent } from './geocodage.component';
import { texte } from '../../testing/dom';
import { fournisseursImportPoi } from '../testing/fournisseurs';

/** Angular retire les blancs entre éléments : les enfants se lisent un à un. */
const enfants = (e: Element) => [...e.children].map((c) => texte(c)).join(' ');
const URL_GEOCODAGE = '/api/admin/geocode/batch';
const URL_CORRECTION = '/api/admin/geocode/update';

async function monter() {
  TestBed.configureTestingModule({ providers: fournisseursImportPoi() });
  const etat = TestBed.inject(ImportPoiService);
  const http = TestBed.inject(HttpTestingController);
  etat.analyser([new File(['x'], 'poi-essai.csv')]);
  http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
  etat.choisirCategorie('essai_lot_6');
  etat.choisirModeGeo('address');
  const f = TestBed.createComponent(GeocodageComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  /** Lance le géocodage par le bouton, servi par la fixture. */
  const geocoder = async () => {
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    await stable();
    http.expectOne(URL_GEOCODAGE).flush(GEOCODAGE_ESSAI);
    await stable();
  };
  const lignes = () => [...el.querySelectorAll<HTMLElement>('[data-ligne]')];
  const cellules = (l: HTMLElement) => [...l.querySelectorAll(':scope > .grille > *')].map((c) => (c.classList.contains('actions') ? enfants(c) : texte(c)));
  return { f, el, etat, http, stable, geocoder, lignes, cellules };
}

describe('mg-import-geocodage — étape 03c « Geocodage adresses » (`GeocodeStep.tsx`, lot 6, T13)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('au repos : numéro, titre, note BAN, « Lancer le geocodage (10 adresses) » ; pendant l’appel « Geocodage en cours... » désactivé', async () => {
    const { el, http, stable } = await monter();
    expect(texte(el.querySelector('[data-num]'))).toBe('03c');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Geocodage adresses');
    expect(texte(el.querySelector('[data-note]'))).toBe('// geocodage via api-adresse.data.gouv.fr (BAN) — endpoint batch CSV');
    const bouton = el.querySelector<HTMLButtonElement>('[data-lancer]')!;
    expect(texte(bouton)).toBe('Lancer le geocodage (10 adresses)');
    bouton.click();
    await stable();
    expect(texte(bouton)).toBe('Geocodage en cours...');
    expect(bouton.disabled).toBe(true);
    http.expectOne(URL_GEOCODAGE).flush({ success: false, error: 'Fichier temporaire introuvable. Re-uploadez le fichier.' }, { status: 404, statusText: 'Not Found' });
    await stable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! Fichier temporaire introuvable. Re-uploadez le fichier.');
    expect(bouton.disabled).toBe(false);
  });

  it('résultats : badges de l’en-tête, trois tuiles, échecs EN TÊTE du tableau, le bouton de lancement disparaît', async () => {
    const { el, geocoder, lignes, cellules } = await monter();
    await geocoder();
    expect(el.querySelector('[data-lancer]')).toBeNull();
    expect([...el.querySelectorAll('[data-badges] .badge')].map((b) => texte(b))).toEqual(['1 OK', '1 approx.', '2 echecs']);
    expect([...el.querySelectorAll('[data-tuile]')].map((t) => enfants(t))).toEqual([
      'Geocodes OK 1 score >= 0.6', 'Approximatifs 1 score 0.3–0.6', 'Non trouves 2 score < 0.3',
    ]);
    expect([...el.querySelectorAll('[data-entetes] span')].map((s) => texte(s))).toEqual(['#', 'Adresse saisie', 'Resultat BAN', 'Score', 'Statut', 'Actions']);
    expect(lignes().map((l) => cellules(l))).toEqual([
      ['3', 'Lieu-dit inconnu 99999', '—', '0.12', 'Echec', 'Corriger Ignorer'],
      ['4', 'vide', '—', '0.00', 'Echec', 'Corriger Ignorer'],
      ['2', 'Quai du Port 13002 Marseille', 'Quai du Port 13002 Marseille', '0.45', 'Approx.', 'Corriger Ignorer'],
      ['1', 'Place Bellecour 69002 Lyon', 'Place Bellecour 69002 Lyon', '0.93', 'OK', ''],
    ]);
    expect(texte(el.querySelector('[data-affiches]'))).toBe('4 resultats affiches');
  });

  it('filtres vert / orange / rouge (barre et tuiles) : comptes par statut, lignes filtrées, bouton actif (`aria-pressed`)', async () => {
    const { el, stable, geocoder, lignes, cellules } = await monter();
    await geocoder();
    const filtres = () => [...el.querySelectorAll<HTMLButtonElement>('[data-filtre]')];
    expect(filtres().map((b) => [texte(b), b.getAttribute('aria-pressed')])).toEqual([
      ['Tous (4)', 'true'], ['Echec (2)', 'false'], ['Approx. (1)', 'false'], ['OK (1)', 'false'],
    ]);
    for (const [filtre, attendu] of [['green', ['1']], ['orange', ['2']], ['red', ['3', '4']]] as const) {
      filtres().find((b) => b.dataset['filtre'] === filtre)!.click();
      await stable();
      expect(lignes().map((l) => cellules(l)[0])).toEqual(attendu);
      expect(texte(el.querySelector('[data-affiches]'))).toBe(`${attendu.length} resultats affiches`);
      expect(filtres().find((b) => b.dataset['filtre'] === filtre)!.getAttribute('aria-pressed')).toBe('true');
    }
    el.querySelector<HTMLButtonElement>('[data-tuile="orange"]')!.click();
    await stable();
    expect(lignes().map((l) => cellules(l)[0])).toEqual(['2']);
    expect(el.querySelector('[data-tuile="orange"]')!.classList).toContain('active');
  });

  it('correction d’une ligne : « Corriger » ouvre le formulaire pré-rempli ; « Re-geocoder », « Valider coords », « Ignorer » → `update` avec chaque action', async () => {
    const { el, http, stable, geocoder, lignes } = await monter();
    await geocoder();
    const ligne = () => lignes().find((l) => l.dataset['ligne'] === '1')!;
    const bouton = (nom: string) => [...ligne().querySelectorAll('button')].find((b) => texte(b) === nom)!;
    bouton('Corriger').click();
    await stable();
    expect(texte(bouton('Fermer'))).toBe('Fermer');
    const champs = [...ligne().querySelectorAll<HTMLInputElement>('[data-edition] input')];
    expect(champs.map((c) => [c.value, c.placeholder])).toEqual([
      ['Quai du Port 13002 Marseille', 'Corrigez l\'adresse et re-geocodez'], ['43.2965', 'Latitude'], ['5.3698', 'Longitude'],
    ]);
    const valider = () => [...ligne().querySelectorAll<HTMLButtonElement>('[data-edition] button')];
    expect(valider().map((b) => texte(b))).toEqual(['Re-geocoder', 'Valider coords']);

    champs[0].value = '  Quai du Port, Marseille  ';
    champs[0].dispatchEvent(new Event('input'));
    await stable();
    valider()[0].click();
    await stable();
    let req = http.expectOne(URL_CORRECTION);
    expect(req.request.body).toEqual({ geocodeId: '1b2c3d4e-5f60', rowIndex: 1, action: { type: 'reGeocode', address: 'Quai du Port, Marseille' } });
    req.flush({
      success: true,
      updatedResult: { ...GEOCODAGE_ESSAI.results![1], score: 0.8, status: 'green', manualOverride: true, resultLabel: 'Quai du Port, Marseille' },
      stats: { green: 2, orange: 0, red: 2 },
    });
    await stable();
    expect(el.querySelector('[data-edition]')).toBeNull();
    expect(texte(lignes().find((l) => l.dataset['ligne'] === '1')!)).toContain('Quai du Port, Marseille [edit]');

    const rouge = () => lignes().find((l) => l.dataset['ligne'] === '2')!;
    [...rouge().querySelectorAll('button')].find((b) => texte(b) === 'Corriger')!.click();
    await stable();
    const [, lat, lng] = [...rouge().querySelectorAll<HTMLInputElement>('[data-edition] input')];
    const coords = [...rouge().querySelectorAll<HTMLButtonElement>('[data-edition] button')][1];
    expect(coords.disabled).toBe(true);
    lat.value = '45.75';
    lat.dispatchEvent(new Event('input'));
    lng.value = 'abc';
    lng.dispatchEvent(new Event('input'));
    await stable();
    expect(coords.disabled).toBe(true);
    lng.value = '4.83';
    lng.dispatchEvent(new Event('input'));
    await stable();
    coords.click();
    await stable();
    req = http.expectOne(URL_CORRECTION);
    expect(req.request.body).toEqual({ geocodeId: '1b2c3d4e-5f60', rowIndex: 2, action: { type: 'manual', lat: 45.75, lng: 4.83 } });
    req.flush({ success: true, updatedResult: { ...GEOCODAGE_ESSAI.results![2], lat: 45.75, lng: 4.83, score: 1, status: 'green', manualOverride: true, resultLabel: 'Saisie manuelle' }, stats: { green: 3, orange: 0, red: 1 } });
    await stable();

    [...lignes().find((l) => l.dataset['ligne'] === '3')!.querySelectorAll('button')].find((b) => texte(b) === 'Ignorer')!.click();
    await stable();
    req = http.expectOne(URL_CORRECTION);
    expect(req.request.body).toEqual({ geocodeId: '1b2c3d4e-5f60', rowIndex: 3, action: { type: 'ignore' } });
    req.flush({ success: true, updatedResult: { ...GEOCODAGE_ESSAI.results![3], manualOverride: true, resultLabel: 'Ignore par l\'utilisateur' }, stats: { green: 3, orange: 0, red: 1 } });
    await stable();
    expect([...el.querySelectorAll('[data-badges] .badge')].map((b) => texte(b))).toEqual(['3 OK', '1 echecs']);
  });

  it('validation : « Valider le geocodage (2 lignes avec coordonnees) », avertissement des échecs, badge « VALIDE » ; désactivé sans aucun OK ; « Relancer » revient au lancement', async () => {
    const { el, etat, stable, geocoder } = await monter();
    await geocoder();
    const valider = el.querySelector<HTMLButtonElement>('[data-valider]')!;
    expect(texte(valider)).toBe('Valider le geocodage (2 lignes avec coordonnees)');
    expect(texte(el.querySelector('[data-sans-coordonnees]'))).toBe('! 2 lignes sans coordonnees (seront exclues)');
    expect(el.querySelector('[data-valide]')).toBeNull();
    valider.click();
    await stable();
    expect(texte(el.querySelector('[data-valide]'))).toBe('VALIDE');
    expect(etat.etapeAccessible()['04']).toBe(true);

    etat.statsGeocodage.set({ green: 0, orange: 3, red: 1 });
    await stable();
    expect(valider.disabled).toBe(true);
    expect(texte(el.querySelector('[data-sans-coordonnees]'))).toBe('! 1 ligne sans coordonnees (seront exclues)');

    el.querySelector<HTMLButtonElement>('[data-relancer]')!.click();
    await stable();
    expect(el.querySelector('[data-lancer]')).not.toBeNull();
    expect(el.querySelector('[data-ligne]')).toBeNull();
    expect(etat.etapeAccessible()['04']).toBe(false);
  });

  it('au-delà de 200 lignes : 200 rendues et « ... et N autres resultats (utilisez les filtres pour affiner) »', async () => {
    const { el, etat, stable } = await monter();
    etat.geocodeId.set('g');
    etat.statsGeocodage.set({ green: 205, orange: 0, red: 0 });
    etat.resultatsGeocodage.set(Array.from({ length: 205 }, (_, i) => ({ ...GEOCODAGE_ESSAI.results![0], rowIndex: i })));
    await stable();
    expect(el.querySelectorAll('[data-ligne]')).toHaveLength(200);
    expect(texte(el.querySelector('[data-reste]'))).toBe('... et 5 autres resultats (utilisez les filtres pour affiner)');
  });
});
