import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { SourcesAdminApi, type RapportImportDsp } from '../data/sources-admin.api';
import { FLUX_IMPORT_DSP } from '../testing/dsp-import.fixture';
import { DialogueImportDspComponent } from './dialogue-import-dsp.component';

const URL_IMPORT = '/api/admin/campaigns/import';
const CSV = new File(['campaign,date\n'], 'campagne-essai.csv', { type: 'text/csv' });

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Polyfill jsdom : `<dialog>` sans showModal/close (patron de `dv360.page.spec.ts`). */
function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

/** jsdom n'a ni DragEvent ni DataTransfer : un événement portant `dataTransfer.files`. */
function deposer(el: HTMLElement, fichier: File): void {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: [fichier], dropEffect: 'none' } });
  el.querySelector('[data-zone]')!.dispatchEvent(e);
}

describe('DialogueImportDspComponent — import d’une campagne DSP en flux SSE (lot 6, T20)', () => {
  let f: ComponentFixture<DialogueImportDspComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let fermetures: number;
  let importes: RapportImportDsp[];

  beforeEach(async () => {
    doublerDialog();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi, NotificationsService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(DialogueImportDspComponent);
    fermetures = 0;
    importes = [];
    f.componentInstance.fermer.subscribe(() => fermetures++);
    f.componentInstance.importe.subscribe((r) => importes.push(r));
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  afterEach(() => http.verify());

  const dialogue = () => el.querySelector('dialog')!;
  const lancer = () => el.querySelector<HTMLButtonElement>('[data-lancer]')!;
  const annuler = () => el.querySelector<HTMLButtonElement>('[data-annuler]')!;
  const croix = () => el.querySelector<HTMLButtonElement>('[data-croix]')!;
  const source = () => el.querySelector<HTMLSelectElement>('[data-source]')!;
  const nom = () => el.querySelector<HTMLInputElement>('[data-nom]')!;
  const evenements = () => [...el.querySelectorAll<HTMLElement>('[data-evenements] [data-evenement]')];
  const lignes = () => evenements().map((e) => texte(e));
  const sortes = () => evenements().map((e) => e.getAttribute('data-evenement'));
  const etat = () => texte(el.querySelector('mg-progression-import .carte > div:first-child'));
  const barre = () => el.querySelector('mg-progression-import [role="progressbar"]');
  const notifications = () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre, n.message ?? '']);

  async function choisirEtLancer(): Promise<TestRequest> {
    deposer(el, CSV);
    await f.whenStable();
    lancer().click();
    await f.whenStable();
    return http.expectOne(URL_IMPORT);
  }

  async function morceau(req: TestRequest, jusqua: string) {
    const bout = FLUX_IMPORT_DSP.indexOf(jusqua);
    expect(bout).toBeGreaterThan(-1);
    req.event({ type: HttpEventType.DownloadProgress, loaded: bout, partialText: FLUX_IMPORT_DSP.slice(0, bout) });
    await f.whenStable();
  }

  it('ouverture : <dialog> modal, textes de React, six sources (adform par défaut), « Lancer l’import » désactivé sans fichier, aucune requête', () => {
    expect(dialogue().hasAttribute('open')).toBe(true);
    expect(texte(el.querySelector('[data-titre]'))).toBe('Importer une campagne DSP');
    expect([...el.querySelectorAll('[data-libelle]')].map(texte)).toEqual([
      'Fichier (CSV ou XLSX)', 'Source DSP', 'Nom (optionnel, auto-détecté sinon)',
    ]);
    expect(texte(el.querySelector('[data-zone]'))).toBe('Glisser-déposer ou cliquer pour sélectionner');
    expect(el.querySelector('[data-zone] input[type="file"]')!.getAttribute('accept')).toBe('.csv,.xlsx');
    expect([...source().options].map((o) => o.value)).toEqual(['adform', 'dv360', 'ttd', 'xandr', 'amazon_dsp', 'other']);
    expect(source().value).toBe('adform');
    expect(nom().placeholder).toBe('Ex: Adform Q1 2026');
    expect(texte(lancer())).toBe('Lancer l\'import');
    expect(lancer().disabled).toBe(true);
    expect(texte(annuler())).toBe('Annuler');
    expect(el.querySelector('[data-evenements]')).toBeNull();
    expect(el.querySelector('[data-rapport]')).toBeNull();
    expect(el.querySelector('mg-progression-import')).toBeNull();
  });

  it('fichier déposé : son nom remplace la consigne, le bouton s’active ; « Annuler » ferme', async () => {
    deposer(el, CSV);
    await f.whenStable();
    expect(texte(el.querySelector('[data-zone] [data-nom-fichier]'))).toBe('campagne-essai.csv');
    expect(lancer().disabled).toBe(false);
    annuler().click();
    expect(fermetures).toBe(1);
  });

  it('import : FormData aux trois champs, événements et barre (étapes nommées d’après les `type`), rapport, notification, relecture demandée', async () => {
    source().value = 'ttd';
    source().dispatchEvent(new Event('change'));
    nom().value = '  [ESSAI lot 6] campagne ';
    nom().dispatchEvent(new Event('input'));
    const req = await choisirEtLancer();
    const corps = req.request.body as FormData;
    expect([...corps.keys()]).toEqual(['file', 'dsp_source', 'campaign_name']);
    expect(corps.get('dsp_source')).toBe('ttd');
    expect(corps.get('campaign_name')).toBe('[ESSAI lot 6] campagne');

    // Pendant : champs, « Annuler » et la croix désactivés, libellé de React.
    expect(texte(lancer())).toBe('Import en cours…');
    expect([lancer().disabled, annuler().disabled, croix().disabled, source().disabled, nom().disabled]).toEqual([true, true, true, true, true]);
    expect(etat()).toBe('Analyse du fichier…');
    expect(el.querySelector('mg-progression-import [data-indeterminee]')).not.toBeNull();

    await morceau(req, 'data: {"type":"progress","processed":20');
    expect(lignes()).toEqual(['Parsing campagne-essai.csv…', '20 lignes détectées, 1 pays']);
    expect(etat()).toBe('Insertion des lignes — 0 / 20');
    expect(barre()!.getAttribute('aria-valuenow')).toBe('0');

    await morceau(req, 'data: {"type":"matching","matched":20');
    expect(lignes().at(-1)).toBe('Matching IRIS pour 20 lignes France…');
    // Le rattachement est UN appel de RPC : aucun compteur d'avancement, barre indéterminée.
    expect(etat()).toBe('Rattachement aux IRIS…');
    expect(barre()!.hasAttribute('aria-valuenow')).toBe(false);

    await morceau(req, 'data: {"type":"complete"');
    expect(etat()).toBe('Agrégats de suivi…');
    expect(importes).toEqual([]);

    req.flush(FLUX_IMPORT_DSP);
    await f.whenStable();
    expect(lignes()).toEqual([
      'Parsing campagne-essai.csv…', '20 lignes détectées, 1 pays', '20/20 lignes insérées',
      'Matching IRIS pour 20 lignes France…', '20/20 lignes matchées IRIS', 'Agrégats de suivi…', '✓ 20 lignes, 20 IRIS (100%)',
    ]);
    expect(sortes()).toEqual(['info', 'info', 'info', 'info', 'info', 'info', 'complete']);
    expect(etat()).toBe('✓ Import terminé');
    expect([...el.querySelectorAll('[data-rapport] [data-cellule]')].map(texte)).toEqual([
      'Lignes', '20', 'Pays', 'France', 'France', '20', 'IRIS', '20 (100%)',
    ]);
    expect(texte(el.querySelector('[data-rapport] [data-rapport-titre]'))).toBe('Import réussi');
    expect(notifications()).toEqual([['success', 'Import terminé', '20 lignes']]);
    expect(importes.map((r) => r.campaign_name)).toEqual(['[ESSAI lot 6] campagne']);
    // Fin : « Fermer » seul (CTA), plus de « Lancer » ni d'« Annuler ».
    expect(el.querySelector('[data-lancer]')).toBeNull();
    expect(el.querySelector('[data-annuler]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-fermer]')!.click();
    expect(fermetures).toBe(1);
  });

  it('non fermable PENDANT l’import : Échap (`cancel`) empêché, fond et croix sans effet ; après la fin, Échap ferme', async () => {
    const req = await choisirEtLancer();
    const cancel = new Event('cancel', { cancelable: true });
    dialogue().dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    dialogue().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    croix().click();
    expect(fermetures).toBe(0);
    expect(dialogue().hasAttribute('open')).toBe(true);

    req.flush(FLUX_IMPORT_DSP);
    await f.whenStable();
    const cancelFin = new Event('cancel', { cancelable: true });
    dialogue().dispatchEvent(cancelFin);
    expect(cancelFin.defaultPrevented).toBe(true);
    expect(fermetures).toBe(1);
  });

  it('au repos : la croix et un clic sur le fond ferment (gestes du `Dialog` de React)', () => {
    croix().click();
    dialogue().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fermetures).toBe(2);
  });

  it('événement `error` : ligne rouge, notification « Erreur », échec nommé, pas de rapport, le bouton revient', async () => {
    const req = await choisirEtLancer();
    req.flush('data: {"type":"parsing","message":"Parsing a.csv…"}\n\ndata: {"type":"error","message":"Colonnes requises manquantes : tracked ads"}\n\n');
    await f.whenStable();
    expect(lignes()).toEqual(['Parsing a.csv…', 'Colonnes requises manquantes : tracked ads']);
    expect(sortes()).toEqual(['info', 'error']);
    expect(notifications()).toEqual([['error', 'Erreur', 'Colonnes requises manquantes : tracked ads']]);
    expect(etat()).toBe('! Colonnes requises manquantes : tracked ads');
    expect(el.querySelector('[data-rapport]')).toBeNull();
    expect(texte(lancer())).toBe('Lancer l\'import');
    expect(lancer().disabled).toBe(false);
    expect(importes).toEqual([]);
  });

  it('refus HTTP : le message de la route (corps texte relu en JSON), sinon « HTTP <statut> » ; réseau coupé : « Erreur réseau »', async () => {
    let req = await choisirEtLancer();
    req.flush('{"error":"Aucun mapping trouvé pour la source « dv360 »","details":{"code":"no_mappings_found"}}', { status: 400, statusText: 'Bad Request' });
    await f.whenStable();
    req = await (async () => { lancer().click(); await f.whenStable(); return http.expectOne(URL_IMPORT); })();
    req.flush('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });
    await f.whenStable();
    expect(etat()).toBe('! HTTP 502');
    lancer().click();
    await f.whenStable();
    http.expectOne(URL_IMPORT).error(new ProgressEvent('error'));
    await f.whenStable();
    expect(notifications()).toEqual([
      ['error', 'Import échoué', 'Aucun mapping trouvé pour la source « dv360 »'],
      ['error', 'Import échoué', 'HTTP 502'],
      ['error', 'Erreur réseau', 'TypeError: Failed to fetch'],
    ]);
    expect(lancer().disabled).toBe(false);
  });

  it('flux tronqué (ni `complete` ni `error`) : « Le flux s’est interrompu avant la fin. », jamais un faux succès', async () => {
    const req = await choisirEtLancer();
    req.flush(FLUX_IMPORT_DSP.slice(0, FLUX_IMPORT_DSP.indexOf('data: {"type":"matching"')));
    await f.whenStable();
    expect(lignes().at(-1)).toBe('Le flux s’est interrompu avant la fin.');
    expect(sortes().at(-1)).toBe('error');
    expect(etat()).toBe('! Le flux s’est interrompu avant la fin.');
    expect(el.querySelector('[data-rapport]')).toBeNull();
    expect(notifications()).toEqual([]);
    expect(importes).toEqual([]);
  });

  it('relancer après un échec : journal et progression repartent de zéro', async () => {
    let req = await choisirEtLancer();
    req.flush('data: {"type":"error","message":"Erreur création campagne : x"}\n\n');
    await f.whenStable();
    lancer().click();
    await f.whenStable();
    expect(evenements()).toEqual([]);
    expect(etat()).toBe('Analyse du fichier…');
    req = http.expectOne(URL_IMPORT);
    req.flush(FLUX_IMPORT_DSP);
    await f.whenStable();
    expect(lignes()[0]).toBe('Parsing campagne-essai.csv…');
  });

  it('destruction pendant l’import (C13) : la requête N’EST PAS annulée, sa suite est ignorée', async () => {
    const req = await choisirEtLancer();
    f.destroy();
    expect(req.cancelled).toBe(false);
    expect(() => req.flush(FLUX_IMPORT_DSP)).not.toThrow();
    expect(notifications()).toEqual([]);
    expect(importes).toEqual([]);
  });
});
