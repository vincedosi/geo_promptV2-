import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { SourcesAdminApi, type CampagneDsp, type RapportImportDsp } from '../data/sources-admin.api';
import { DialogueImportDspComponent } from './dialogue-import-dsp.component';
import { DspComponent } from './dsp.component';

const URL_LISTE = '/api/admin/campaigns';

function campagne(p: Partial<CampagneDsp> & { id: string; name: string }): CampagneDsp {
  return {
    dsp_source: 'adform', date_start: '2026-10-01', date_end: '2026-10-07', total_tracked_ads: 3290, countries: ['France'],
    total_rows: 20, france_rows: 20, matched_iris: 20, ...p,
  };
}

const CAMPAGNES: CampagneDsp[] = [
  campagne({ id: 'c1', name: '[ESSAI lot 6] campagne' }),
  campagne({
    id: 'c2', name: 'Démo pilotage — élections', dsp_source: 'magelian', date_start: null, date_end: null, total_tracked_ads: 1234567,
    countries: null, total_rows: 1500, france_rows: 0, matched_iris: 0,
  }),
  campagne({ id: 'c3', name: 'Sans IRIS', total_rows: 10, france_rows: 10, matched_iris: 0 }),
];

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** `formaterNombre` sépare les milliers par une espace insécable : on compare sans elle. */
const espaces = (s: string) => s.replace(/\s/g, ' ');

function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

describe('DspComponent — onglet DSP des Sources : liste, import, suppression (lot 6, T20)', () => {
  let f: ComponentFixture<DspComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let nombres: number[];

  beforeEach(async () => {
    doublerDialog();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi, NotificationsService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(DspComponent);
    nombres = [];
    f.componentInstance.nombre.subscribe((n) => nombres.push(n));
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  afterEach(() => http.verify());

  const stable = () => f.whenStable();
  const cartes = () => [...el.querySelectorAll<HTMLElement>('[data-campagne]')];
  const confirmation = () => el.querySelector('mg-confirmation dialog')!;
  const notifications = () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre, n.message ?? '']);

  async function servir(liste: CampagneDsp[] = CAMPAGNES) {
    http.expectOne(URL_LISTE).flush(liste);
    await stable();
  }

  it('montage : UNE lecture des campagnes (à chaque visite de l’onglet, comme React), « Chargement… » d’ici là, en-tête et bouton', async () => {
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement…');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Campagnes DSP importées');
    expect(texte(el.querySelector('[data-importer]'))).toBe('Importer une campagne');
    await servir();
    expect(el.querySelector('[data-chargement]')).toBeNull();
    expect(nombres).toEqual([3]);
  });

  it('cartes : nom, source, dates jj/mm/aa, compteurs fr-FR, pays, IRIS rattachés (vert si > 0, absent sans ligne France)', async () => {
    await servir();
    expect(cartes().map((c) => c.getAttribute('data-campagne'))).toEqual(['c1', 'c2', 'c3']);
    const ligne = (c: HTMLElement) => [...c.querySelectorAll('[data-meta] > span')].map((s) => espaces(texte(s)));
    expect(texte(cartes()[0].querySelector('[data-nom]'))).toBe('[ESSAI lot 6] campagne');
    expect(texte(cartes()[0].querySelector('[data-badge]'))).toBe('adform');
    expect(ligne(cartes()[0])).toEqual(['01/10/26 → 07/10/26', '3 290 tracked ads', '20 lignes', 'France', '20 IRIS (100%)']);
    expect(ligne(cartes()[1])).toEqual(['— → —', '1 234 567 tracked ads', '1 500 lignes', '—']);
    expect(ligne(cartes()[2]).at(-1)).toBe('0 IRIS (0%)');
    expect(cartes()[0].querySelector('[data-iris]')!.classList.contains('rattache')).toBe(true);
    expect(cartes()[2].querySelector('[data-iris]')!.classList.contains('rattache')).toBe(false);
  });

  it('le nom n’est PAS un lien vers la carte React (`/map?campaign=`) : inerte, « Disponible prochainement »', async () => {
    await servir();
    const n = cartes()[0].querySelector('[data-nom]')!;
    expect(n.hasAttribute('href')).toBe(false);
    expect(n.getAttribute('aria-disabled')).toBe('true');
    expect(n.getAttribute('title')).toBe('Disponible prochainement');
  });

  it('liste vide, ou lecture en échec (React : `console.error` et liste vide) : « Aucune campagne DSP importée »', async () => {
    await servir([]);
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucune campagne DSP importée');
    expect(nombres).toEqual([0]);
    f.destroy();
    f = TestBed.createComponent(DspComponent);
    el = f.nativeElement as HTMLElement;
    await stable();
    http.expectOne(URL_LISTE).flush({ error: 'Internal server error' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucune campagne DSP importée');
  });

  it('« Importer une campagne » monte le dialogue (vierge à chaque ouverture) ; `fermer` le démonte ; `importe` relit la liste', async () => {
    await servir();
    expect(el.querySelector('mg-dialogue-import-dsp')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-importer]')!.click();
    await stable();
    const dialogue = f.debugElement.query(By.directive(DialogueImportDspComponent));
    expect(dialogue).not.toBeNull();
    (dialogue.componentInstance as DialogueImportDspComponent).importe.emit({ campaign_name: 'x' } as RapportImportDsp);
    await stable();
    http.expectOne(URL_LISTE).flush(CAMPAGNES.slice(0, 1));
    await stable();
    expect(cartes()).toHaveLength(1);
    expect(nombres).toEqual([3, 1]);
    // Le dialogue reste ouvert sur son rapport : c'est « Fermer » qui le démonte.
    expect(el.querySelector('mg-dialogue-import-dsp')).not.toBeNull();
    (dialogue.componentInstance as DialogueImportDspComponent).fermer.emit();
    await stable();
    expect(el.querySelector('mg-dialogue-import-dsp')).toBeNull();
  });

  it('suppression : `mg-confirmation` aux textes de React, puis DELETE, notification, retrait immédiat et relecture', async () => {
    await servir();
    expect(confirmation().hasAttribute('open')).toBe(false);
    cartes()[0].querySelector<HTMLButtonElement>('[data-supprimer]')!.click();
    await stable();
    expect(confirmation().hasAttribute('open')).toBe(true);
    expect(texte(el.querySelector('mg-confirmation [id]'))).toBe('Supprimer cette campagne DSP');
    expect(texte(confirmation())).toContain('La campagne et toutes ses données seront définitivement supprimées.');
    el.querySelector<HTMLButtonElement>('mg-confirmation .confirmer')!.click();
    await stable();
    const d = http.expectOne('/api/admin/campaigns/c1');
    expect(d.request.method).toBe('DELETE');
    expect(texte(el.querySelector('mg-confirmation .confirmer'))).toBe('En cours...');
    d.flush({ success: true, deleted: 1 });
    await stable();
    expect(notifications()).toEqual([['success', 'Campagne supprimée', '']]);
    expect(confirmation().hasAttribute('open')).toBe(false);
    // React retire la carte puis relit aussitôt : la relecture remet « Chargement… », comme ici.
    expect(el.querySelector('[data-chargement]')).not.toBeNull();
    http.expectOne(URL_LISTE).flush(CAMPAGNES.slice(1));
    await stable();
    expect(cartes().map((c) => c.getAttribute('data-campagne'))).toEqual(['c2', 'c3']);
    expect(nombres).toEqual([3, 2]);
  });

  it('suppression refusée : `error` de la route, « Suppression échouée » sans `error`, « HTTP <statut> » sur un corps illisible, « Erreur réseau »', async () => {
    await servir();
    const supprimer = async (corps: string | object | null, statut: number) => {
      cartes()[0].querySelector<HTMLButtonElement>('[data-supprimer]')!.click();
      await stable();
      el.querySelector<HTMLButtonElement>('mg-confirmation .confirmer')!.click();
      await stable();
      const d = http.expectOne('/api/admin/campaigns/c1');
      if (statut === 0) d.error(new ProgressEvent('error'));
      else d.flush(corps, { status: statut, statusText: 'Erreur' });
      await stable();
    };
    await supprimer({ error: 'Internal server error' }, 500);
    await supprimer({}, 500);
    await supprimer(null, 0);
    expect(notifications()).toEqual([
      ['error', 'Erreur', 'Internal server error'],
      ['error', 'Erreur', 'Suppression échouée'],
      ['error', 'Erreur réseau', 'TypeError: Failed to fetch'],
    ]);
    await supprimer('<html>502</html>', 502);
    expect(notifications().at(-1)).toEqual(['error', 'Erreur', 'HTTP 502']);
    expect(cartes()).toHaveLength(3);
    expect(confirmation().hasAttribute('open')).toBe(false);
  });
});
