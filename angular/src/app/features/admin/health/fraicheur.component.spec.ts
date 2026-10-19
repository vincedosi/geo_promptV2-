import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import { FraicheurApi, type ReponseFraicheur, type SourceAffichee } from './data/fraicheur.api';
import { FraicheurEtatService } from './etat/fraicheur-etat.service';
import { FraicheurComponent } from './fraicheur.component';

const URL = '/api/admin/fraicheur-donnees';

function source(p: Partial<SourceAffichee> & { id: string }): SourceAffichee {
  return {
    libelle: p.id, nature: 'cache', provenance: 'Fournisseur', collecte: 'Collecte', table: 'une_table',
    cadenceAttendueJours: null, coutMesure: 'leger', note: null, etat: 'sans_objet', ageJours: null,
    nLignes: null, nEstime: false, donneeMin: null, donneeMax: null, ingestionMax: null, nonMesure: null,
    ...p,
  };
}

function reponse(): ReponseFraicheur {
  return {
    mesureLe: '2026-10-07T09:15:00.000Z',
    dureeMs: 42,
    sources: [
      source({ id: 'meteo', libelle: 'Météo', nature: 'live', table: null, note: 'Jamais stockée.' }),
      source({
        id: 'pollen', libelle: 'Pollen par code postal', etat: 'en_retard', ageJours: 3, cadenceAttendueJours: 1,
        nLignes: 12345, donneeMin: '2026-10-01', donneeMax: '2026-10-03', ingestionMax: '2026-10-03T05:30:00Z',
      }),
      source({ id: 'atmo', libelle: 'Air', etat: 'a_jour', ageJours: 0, donneeMin: '2026-10-07', donneeMax: '2026-10-07' }),
      source({
        id: 'flux_routier', libelle: 'Flux routier', nature: 'referentiel', coutMesure: 'lourd', etat: 'jamais_mesure',
        nLignes: 408030, nEstime: true, donneeMax: '2019',
      }),
      source({ id: 'radio', libelle: 'Radio', nature: 'referentiel', etat: 'sans_objet', ageJours: 120 }),
    ],
  };
}

describe('FraicheurComponent', () => {
  let f: ComponentFixture<FraicheurComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), FraicheurApi, FraicheurEtatService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(FraicheurComponent);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    f.detectChanges();
  });

  afterEach(() => { vi.useRealTimers(); http.verify(); });

  const texte = (sel: string) => el.querySelector(sel)?.textContent?.replace(/[ \t\r\n]+/g, ' ').trim() ?? null;
  const relancer = () => el.querySelector<HTMLButtonElement>('[data-relancer]')!;
  const lourd = () => el.querySelector<HTMLButtonElement>('[data-mesure-lourde]')!;
  const charge = () => { http.expectOne(URL).flush(reponse()); f.detectChanges(); };

  it('ouverture : UN GET, aucun POST ; « Lecture du relevé… » et boutons désactivés pendant', () => {
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('GET');
    expect(texte('[data-releve]')).toBe('Lecture du relevé…');
    expect(relancer().disabled).toBe(true);
    req.flush(reponse());
    f.detectChanges();
    expect(relancer().disabled).toBe(false);
  });

  it('chargé : date du relevé, badges de synthèse, lignes du tableau dans l’ordre', () => {
    charge();
    const attendu = `Relevé du ${new Date('2026-10-07T09:15:00.000Z').toLocaleString('fr-FR')} · 42 ms`;
    expect(texte('[data-releve]')).toBe(attendu);
    expect(texte('[data-synthese="en_retard"]')).toBe('1 en retard');
    expect(texte('[data-synthese="jamais_mesure"]')).toBe('1 jamais mesuré');
    const lignes = el.querySelectorAll('tbody tr');
    expect(lignes.length).toBe(5);
    expect(texte('tbody tr:nth-child(1) [data-libelle]')).toBe('Météo');
    expect(texte('tbody tr:nth-child(1) [data-nature]')).toBe('Live');
    expect(texte('tbody tr:nth-child(1) [data-stockage]')).toBe('hors base');
    expect(texte('tbody tr:nth-child(1) [data-note]')).toBe('Jamais stockée.');
    expect(texte('tbody tr:nth-child(2) [data-etat]')).toBe('En retard de 3 j');
    expect(texte('tbody tr:nth-child(2) [data-lignes]')).toBe(formaterNombre(12345));
    expect(texte('tbody tr:nth-child(2) [data-millesime]')).toBe('01/10/2026 → 03/10/2026');
    expect(texte('tbody tr:nth-child(2) [data-entree]')).toBe('03/10/2026 attendu tous les 1 j');
    expect(texte('tbody tr:nth-child(3) [data-etat]')).toBe('À jour');
    expect(texte('tbody tr:nth-child(3) [data-millesime]')).toBe('07/10/2026');
    expect(texte('tbody tr:nth-child(4) [data-etat]')).toBe('Jamais mesuré');
    expect(texte('tbody tr:nth-child(4) [data-lignes]')).toBe(`~${formaterNombre(408030)} estimé`);
    expect(texte('tbody tr:nth-child(4) [data-millesime]')).toBe('2019');
    expect(texte('tbody tr:nth-child(5) [data-etat]')).toBe('il y a 4 mois');
    expect(texte('tbody tr:nth-child(5) [data-lignes]')).toBe('—');
    expect(el.querySelectorAll('[data-legende] [data-nature]').length).toBe(4);
  });

  it('sous-titre de React en tête de l’onglet (remonté de l’en-tête du Health check)', () => {
    charge();
    expect(texte('[data-sous-titre]')).toBe('D’où vient chaque donnée, comment elle entre, et de quand elle date');
  });

  it('écran détruit puis recréé (retour sur l’onglet) : le relevé est réaffiché sans nouveau GET', () => {
    charge();
    f.destroy();
    const retour = TestBed.createComponent(FraicheurComponent);
    retour.detectChanges();
    http.expectNone(URL);
    expect((retour.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(5);
  });

  it('une mesure lancée survit au changement d’onglet : son résultat est affiché au retour', () => {
    charge();
    relancer().click();
    const req = http.expectOne(URL);
    f.destroy();
    req.flush({ ...reponse(), dureeMs: 88, persiste: true });
    const retour = TestBed.createComponent(FraicheurComponent);
    retour.detectChanges();
    http.expectNone(URL);
    expect((retour.nativeElement as HTMLElement).querySelector('[data-releve]')?.textContent).toContain('· 88 ms');
  });

  it('aucun relevé : phrase de React', () => {
    http.expectOne(URL).flush({ ...reponse(), mesureLe: null, dureeMs: null });
    f.detectChanges();
    expect(texte('[data-releve]')).toBe('Aucun relevé : rien n’a encore été mesuré.');
  });

  it('le coût de la mesure lourde est affiché AVANT le clic (title et légende)', () => {
    charge();
    expect(el.querySelectorAll('[data-mesure-lourde]').length).toBe(1);
    expect(lourd().title).toBe('Cette mesure balaye la table : 347 Mo lus, environ 1,8 s');
    expect(texte('[data-cout-lourd]')).toBe('347 Mo lus, hors mesure ordinaire');
    expect(texte('[data-mesure-lourde]')).toBe('Mesurer');
  });

  it('« Relancer la mesure » : POST { inclureLourd: false }, boutons désactivés pendant, relevé remplacé', () => {
    charge();
    relancer().click();
    f.detectChanges();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ inclureLourd: false });
    expect(texte('[data-relancer]')).toBe('Mesure en cours…');
    expect(relancer().disabled).toBe(true);
    expect(lourd().disabled).toBe(true);
    // Un second clic pendant la mesure n'envoie rien.
    relancer().click();
    http.expectNone(URL);
    req.flush({ ...reponse(), dureeMs: 77, persiste: true });
    f.detectChanges();
    expect(texte('[data-releve]')).toContain('· 77 ms');
    expect(relancer().disabled).toBe(false);
    expect(el.querySelector('[data-erreur]')).toBeNull();
  });

  it('mesure lourde : POST { inclureLourd: true }, « Mesure… », les DEUX boutons désactivés pendant, un seul envoi', () => {
    charge();
    lourd().click();
    f.detectChanges();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ inclureLourd: true });
    expect(texte('[data-mesure-lourde]')).toBe('Mesure…');
    expect(texte('[data-relancer]')).toBe('Relancer la mesure');
    expect(lourd().disabled).toBe(true);
    expect(relancer().disabled).toBe(true);
    lourd().click();
    relancer().click();
    http.expectNone(URL);
    req.flush(reponse());
    f.detectChanges();
    expect(lourd().disabled).toBe(false);
  });

  it('429 : le message du SERVEUR, aucune relance automatique (ni immédiate ni DIFFÉRÉE), relevé gardé', () => {
    vi.useFakeTimers();
    charge();
    lourd().click();
    f.detectChanges();
    http.expectOne(URL).flush(
      { error: 'Trop de requêtes. Réessayez dans quelques instants.', retry_after: 51 },
      { status: 429, statusText: 'Too Many Requests' },
    );
    f.detectChanges();
    expect(texte('[data-erreur]')).toBe('Trop de requêtes. Réessayez dans quelques instants.');
    // Vague finale G4 : au-delà du `retry_after` de 51 s, toujours aucune relance minutée.
    vi.advanceTimersByTime(60_000);
    http.expectNone(URL);
    vi.useRealTimers();
    expect(el.querySelectorAll('tbody tr').length).toBe(5);
    expect(lourd().disabled).toBe(false);
  });

  it('persiste: false : la mesure s’affiche, avec l’avertissement de React', () => {
    charge();
    relancer().click();
    http.expectOne(URL).flush({ ...reponse(), persiste: false });
    f.detectChanges();
    expect(texte('[data-erreur]')).toBe('Mesure faite, mais elle n’a pas pu être enregistrée : elle sera perdue au rechargement.');
  });

  it('lecture en échec : le message du serveur, sinon « Lecture impossible. »', () => {
    http.expectOne(URL).flush({ error: 'Erreur base de données.' }, { status: 500, statusText: 'x' });
    f.detectChanges();
    expect(texte('[data-erreur]')).toBe('Erreur base de données.');
    expect(texte('[data-releve]')).toBe('Aucun relevé : rien n’a encore été mesuré.');
  });

  it('vague finale G1 — PREMIÈRE lecture en échec : quitter puis revenir sur l’onglet la retente (un nouveau GET)', () => {
    http.expectOne(URL).flush({ error: 'Erreur base de données.' }, { status: 500, statusText: 'x' });
    f.detectChanges();
    f.destroy();
    const retour = TestBed.createComponent(FraicheurComponent);
    retour.detectChanges();
    http.expectOne(URL).flush(reponse());
    retour.detectChanges();
    const r = retour.nativeElement as HTMLElement;
    expect(r.querySelector('[data-erreur]')).toBeNull();
    expect(r.querySelectorAll('tbody tr').length).toBe(5);
  });

  it('mesure en échec sans corps lisible : « La mesure a échoué. »', () => {
    charge();
    relancer().click();
    http.expectOne(URL).flush('boom', { status: 500, statusText: 'x' });
    f.detectChanges();
    expect(texte('[data-erreur]')).toBe('La mesure a échoué.');
  });
});
