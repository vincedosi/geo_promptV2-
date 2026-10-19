import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { formaterNombre } from '../../../../core/format/nombre';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { CategoriesPoiApi } from '../../commun/data/categories-poi.api';
import { OrganisationsListeApi } from '../../commun/data/organisations-liste.api';
import { ImportPoiApi } from '../data/import-poi.api';
import { ImportPoiService } from '../etat/import-poi.service';
import { ESSAI_A_BLANC } from '../testing/geocodage.fixture';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { FLUX_IMPORT_COMPLET, FLUX_SOURCE_IMPOSSIBLE } from '../testing/import-poi-sse.fixture';
import { ImportComponent } from './import.component';

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const espaces = (s: string) => s.replace(/\s/g, ' ');
/** Angular retire les blancs entre éléments : les enfants se lisent un à un. */
const enfants = (e: Element | null) => (e ? [...e.children].map((c) => texte(c)).join(' ') : '');
const URL_IMPORT = '/api/admin/import-poi/execute';

/** Polyfill jsdom : `<dialog>` sans showModal/close (patron de `dv360.page.spec.ts`). */
function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

async function monter(organisations = [{ id: 'o1', name: 'Espace A' }, { id: 'o2', name: 'Espace B' }]) {
  doublerDialog();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportPoiApi, CategoriesPoiApi, OrganisationsListeApi,
      NotificationsService, ImportPoiService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const etat = TestBed.inject(ImportPoiService);
  const http = TestBed.inject(HttpTestingController);
  etat.organisations.set(organisations);
  etat.analyser([new File(['x'], 'poi-essai.csv')]);
  http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
  etat.choisirCategorie('essai_lot_6');
  etat.essayer();
  http.expectOne('/api/admin/import-poi/dry-run').flush(ESSAI_A_BLANC);
  const f = TestBed.createComponent(ImportComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  const bouton = () => el.querySelector<HTMLButtonElement>('[data-lancer]')!;
  const dialogue = () => el.querySelector('mg-confirmation dialog')!;
  const boutonDialogue = (nom: string) => [...dialogue().querySelectorAll('button')].find((b) => texte(b) === nom)!;
  const journal = () => [...el.querySelectorAll('[data-terminal] > div')].map((d) => texte(d));
  const progression = () => espaces(texte(el.querySelector('mg-progression-import')));
  /** Bouton → confirmation → « Lancer l'import » : la requête du flux. */
  const lancer = async (): Promise<TestRequest> => {
    bouton().click();
    await stable();
    boutonDialogue('Lancer l\'import').click();
    await stable();
    return http.expectOne(URL_IMPORT);
  };
  const morceau = async (req: TestRequest, flux: string, jusqua: string) => {
    const bout = flux.indexOf(jusqua);
    req.event({ type: HttpEventType.DownloadProgress, loaded: bout, partialText: flux.slice(0, bout) });
    await stable();
  };
  return { f, el, etat, http, stable, bouton, dialogue, boutonDialogue, journal, progression, lancer, morceau };
}

describe('mg-import-reel — étape 05 « Import reel » (`ImportStep.tsx`, `ImportLogPanel.tsx`, lot 6, T13)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('au repos : nom de source (exemple daté), organisations, bouton et avertissement de React ; ni progression ni journal', async () => {
    const { el, bouton } = await monter();
    expect(texte(el.querySelector('[data-num]'))).toBe('05');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Import reel');
    const nom = el.querySelector<HTMLInputElement>('#import-poi-source')!;
    expect(nom.placeholder).toBe(`Import POI — ${new Date().toLocaleDateString('fr-FR')}`);
    expect(texte(el.querySelector('label[for="import-poi-source"]'))).toBe('Nom de la source (optionnel)');
    expect(texte(el.querySelector('label[for="import-poi-organisation"]'))).toBe('Organisation');
    expect([...el.querySelectorAll('#import-poi-organisation option')].map((o) => texte(o))).toEqual(['Espace A', 'Espace B']);
    expect(texte(bouton())).toBe('LANCER L\'IMPORT REEL');
    expect(espaces(texte(el.querySelector('[data-avertissement]')))).toBe(espaces(`! Insertion en base Supabase (${formaterNombre(10)} lignes)`));
    expect(el.querySelector('mg-progression-import')).toBeNull();
    expect(el.querySelector('mg-journal')).toBeNull();
  });

  it('sans organisations lues : l’option de repli « dentsu.explore (interne) » (`ORG_GLOBALE_FALLBACK`)', async () => {
    const { el } = await monter([]);
    const options = [...el.querySelectorAll<HTMLOptionElement>('#import-poi-organisation option')];
    expect(options.map((o) => [texte(o), o.value])).toEqual([['dentsu.explore (interne)', '00000000-0000-0000-0000-000000000001']]);
  });

  it('confirmation (C6, texte EXACT du `confirm()` de React) : « Annuler » → AUCUNE requête ; « Lancer l’import » → le POST', async () => {
    const { bouton, dialogue, boutonDialogue, http, stable, lancer } = await monter();
    bouton().click();
    await stable();
    expect(dialogue().hasAttribute('open')).toBe(true);
    expect(texte(dialogue())).toContain('Lancer l\'import reel en base Supabase ?');
    http.expectNone(URL_IMPORT);
    boutonDialogue('Annuler').click();
    await stable();
    expect(dialogue().hasAttribute('open')).toBe(false);
    http.expectNone(URL_IMPORT);

    const req = await lancer();
    expect(dialogue().hasAttribute('open')).toBe(false);
    expect(req.request.method).toBe('POST');
    expect((req.request.body as Record<string, unknown>)['organizationId']).toBe('00000000-0000-0000-0000-000000000001');
    req.flush(FLUX_IMPORT_COMPLET);
    await stable();
  });

  it('nom de source et organisation saisis partent dans le corps', async () => {
    const { el, stable, lancer } = await monter();
    const nom = el.querySelector<HTMLInputElement>('#import-poi-source')!;
    nom.value = 'Essai lot 6';
    nom.dispatchEvent(new Event('input'));
    const org = el.querySelector<HTMLSelectElement>('#import-poi-organisation')!;
    org.value = 'o2';
    org.dispatchEvent(new Event('change'));
    await stable();
    const req = await lancer();
    expect(req.request.body).toMatchObject({ sourceName: 'Essai lot 6', organizationId: 'o2' });
    req.flush(FLUX_IMPORT_COMPLET);
    await stable();
  });

  it('flux en morceaux : début (étape nommée, barre indéterminée), milieu (journal, compteurs), fin (rapport, badge, journal complet)', async () => {
    const { el, bouton, journal, progression, lancer, morceau, stable } = await monter();
    const req = await lancer();
    expect(texte(bouton())).toBe('Import en cours...');
    expect(bouton().disabled).toBe(true);
    expect(progression()).toContain('Lancement…');
    expect(el.querySelector('mg-progression-import [role="progressbar"]')!.hasAttribute('aria-valuenow')).toBe(false);

    await morceau(req, FLUX_IMPORT_COMPLET, 'data: {"type":"log","logLevel":"info","logLine":"--- Batch');
    // Vague finale E4 : le journal « Insertion en base… » nomme l’étape (avant : « Source "…" creee » restait affiché).
    expect(progression()).toContain(espaces(`Insertion en base Supabase — 0 / ${formaterNombre(10)}`));
    expect(espaces(enfants(el.querySelector('[data-compteurs]')))).toBe('traites: 0/10');
    expect(journal()).toEqual([
      'Insertion en base Supabase (10 lignes)...',
      '====== START: 10 lignes, type="poi" (Supabase JS) ======',
      'Connexion Supabase OK — table "poi_france"',
    ]);
    expect(texte(el.querySelector('[data-en-cours]'))).toBe('> en cours...');
    expect(espaces(enfants(el.querySelector('[data-entete-journal]')))).toBe('// JOURNAL EN DIRECT OK 0 SKIP 0 ERR 0 3 lignes');

    req.flush(FLUX_IMPORT_COMPLET);
    await stable();
    expect(progression()).toContain('✓ Import terminé');
    expect(el.querySelector('mg-progression-import [role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    expect(texte(el.querySelector('[data-inseres]'))).toBe('10 inseres');
    expect(texte(el.querySelector('[data-bilan]'))).toBe('[OK] Import termine avec succes');
    expect([...el.querySelectorAll('[data-rapport] > div')].map((d) => texte(d))).toEqual([
      'total: 10', 'inseres: 10', 'ignores: 0', 'erreurs: 0',
    ]);
    expect(journal()).toHaveLength(16);
    expect(journal()[4]).toBe('[OK] #0 [ESSAI lot 6] POI 01 (48.8566, 2.3522) → insere');
    expect(espaces(enfants(el.querySelector('[data-entete-journal]')))).toBe('// JOURNAL EN DIRECT OK 10 SKIP 0 ERR 0 16 lignes');
    expect(el.querySelector('[data-en-cours]')).toBeNull();
    expect(texte(bouton())).toBe('LANCER L\'IMPORT REEL');
    expect(el.querySelector('[data-erreur]')).toBeNull();
  });

  it('second import du même fichier : `ignored = 10` (identité déterministe) → « ignores: 10 », journal en [SKIP]', async () => {
    const { el, lancer, stable } = await monter();
    const rejeu = FLUX_IMPORT_COMPLET
      .replace(/"logLevel":"info","logLine":"\[OK\] (#\d+ \[ESSAI lot 6\] POI \d+) \([^)]*\) → insere"/g, '"logLevel":"warn","logLine":"[SKIP] $1 → doublon"')
      .replace('+10 inseres, 0 ignores', '+0 inseres, 10 ignores')
      .replace('"inserted":10,"ignored":0', '"inserted":0,"ignored":10')
      .replace('inserted=10, ignored=0', 'inserted=0, ignored=10')
      .replace('"report":{"total":10,"inserted":10,"ignored":0', '"report":{"total":10,"inserted":0,"ignored":10');
    (await lancer()).flush(rejeu);
    await stable();
    expect([...el.querySelectorAll('[data-rapport] > div')].map((d) => texte(d))).toEqual([
      'total: 10', 'inseres: 0', 'ignores: 10', 'erreurs: 0',
    ]);
    expect(espaces(enfants(el.querySelector('[data-entete-journal]')))).toBe('// JOURNAL EN DIRECT OK 0 SKIP 10 ERR 0 16 lignes');
    expect(espaces(enfants(el.querySelector('[data-compteurs]')))).toBe('traites: 10/10 inseres: 0 ignores: 10');
  });

  it('A3 — la source ne peut être créée : « ! Impossible de créer la source de données… », au journal aussi ; ni rapport ni barre pleine', async () => {
    const { el, journal, progression, lancer, stable } = await monter();
    (await lancer()).flush(FLUX_SOURCE_IMPOSSIBLE);
    await stable();
    const message = 'Impossible de créer la source de données : import arrêté, aucune ligne écrite.';
    expect(texte(el.querySelector('[data-erreur]'))).toBe(`! ${message}`);
    expect(journal()).toEqual([`! ${message}`]);
    expect(progression()).toContain(`! ${message}`);
    expect(el.querySelector('[data-rapport]')).toBeNull();
    expect((el.querySelector('[data-remplissage]') as HTMLElement).style.width).toBe('0%');
  });

  it('flux tronqué : « Le flux s’est interrompu avant la fin. », pas de rapport, le bouton revient', async () => {
    const { el, bouton, progression, lancer, stable } = await monter();
    (await lancer()).flush(FLUX_IMPORT_COMPLET.slice(0, FLUX_IMPORT_COMPLET.indexOf('data: {"type":"complete"')));
    await stable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! Le flux s’est interrompu avant la fin.');
    expect(progression()).toContain('! Le flux s’est interrompu avant la fin.');
    expect(el.querySelector('[data-rapport]')).toBeNull();
    expect(bouton().disabled).toBe(false);
  });

  it('rapport partiel ou échoué et première erreur SQL (`firstError`) : textes de React', async () => {
    const { el, etat, stable } = await monter();
    etat.rapport.set({ total: 10, inserted: 4, ignored: 0, errors: 6 });
    await stable();
    expect(texte(el.querySelector('[data-bilan]'))).toBe('! Import partiel — 4 inseres, 6 erreurs');
    etat.rapport.set({ total: 10, inserted: 0, ignored: 0, errors: 10 });
    etat.premiereErreur.set('column "x" does not exist');
    await stable();
    expect(texte(el.querySelector('[data-bilan]'))).toBe('! Import echoue — 10 erreurs, 0 inseres');
    const sql = [...el.querySelector('[data-erreur-sql]')!.children].map((d) => texte(d));
    expect(sql).toEqual(['! Erreur SQL detectee', 'column "x" does not exist', '→ Si "column does not exist": executer le SQL ALTER TABLE dans Supabase Dashboard']);
  });

  it('destruction pendant l’import : la requête N’EST PAS annulée (C13)', async () => {
    const { f, lancer, morceau } = await monter();
    const req = await lancer();
    await morceau(req, FLUX_IMPORT_COMPLET, 'data: {"type":"log","logLevel":"info","logLine":"--- Batch');
    f.destroy();
    expect(req.cancelled).toBe(false);
    expect(() => req.flush(FLUX_IMPORT_COMPLET)).not.toThrow();
  });
});
