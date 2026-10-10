import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeteoService, type ProgressionMeteo } from '../../couches/meteo.service';
import { PileEchapService } from '../../etat/pile-echap.service';
import type { MeteoParams, MeteoZoneMeta } from '../../logique/meteo/types';
import { DialogueMeteoComponent, validerPeriodeDialogue } from './dialogue-meteo.component';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }), configurable: true, writable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value: vi.fn(function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    }), configurable: true, writable: true,
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

async function monter() {
  const appliques: MeteoParams[] = [];
  const fermetures: number[] = [];
  const meteo = {
    chargement: signal(false),
    progression: signal<ProgressionMeteo | null>(null),
    erreur: signal<string | null>(null),
    meta: signal<MeteoZoneMeta | null>(null),
    appliquer: (p: MeteoParams) => appliques.push(p),
    fermerDialogue: () => fermetures.push(1),
  };
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), PileEchapService, { provide: MeteoService, useValue: meteo }],
  });
  const pile = TestBed.inject(PileEchapService);
  pile.empiler('panneau', () => undefined);
  const f = TestBed.createComponent(DialogueMeteoComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const cliquer = async (sel: string) => {
    el.querySelector<HTMLElement>(sel)!.click();
    await f.whenStable();
  };
  const texte = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { f, el, meteo, pile, appliques, fermetures, cliquer, texte };
}

describe('DialogueMeteoComponent', () => {
  it('s’ouvre en modale, en tête de la pile Échap (`meteo`) ; défauts de React : précipitations, département, prévisions 7 jours', async () => {
    const { el, pile } = await monter();
    expect(el.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    expect(pile.etat().map((e) => e.id)).toEqual(['panneau', 'meteo']);
    expect(el.querySelector('[data-variable="precipitation"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[data-echelle="departement"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[data-mode="forecast"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector<HTMLInputElement>('[data-debut]')!.value).toBe('2026-10-10');
    expect(el.querySelector<HTMLInputElement>('[data-fin]')!.value).toBe('2026-10-17');
    expect(el.querySelector('[data-titre]')!.textContent).toBe('Zones météo');
  });

  it('température, maille département, 7 derniers jours → appliquer avec ces paramètres', async () => {
    const { cliquer, appliques } = await monter();
    await cliquer('[data-variable="temperature_2m"]');
    await cliquer('[data-mode="history"]');
    await cliquer('[data-preset="7 derniers jours"]');
    await cliquer('[data-appliquer]');
    expect(appliques).toEqual([{ variable: 'temperature_2m', startDate: '2026-10-03', endDate: '2026-10-09', scale: 'departement' }]);
  });

  it('code postal : l’avertissement d’échantillonnage de React', async () => {
    const { cliquer, texte } = await monter();
    expect(texte('[data-aide-cp]')).toBeNull();
    await cliquer('[data-echelle="cp"]');
    expect(texte('[data-aide-cp]')).toBe('Les CP de la vue carte sont interrogés. Vue France entière : valeurs échantillonnées (~30 km, la résolution du modèle météo) — zoomez sur votre zone avant d\'appliquer pour des valeurs par CP exactes.');
  });

  it('période invalide : message de validation, « Appliquer » désactivé, aucun appel', async () => {
    const { el, f, cliquer, texte, appliques } = await monter();
    const fin = el.querySelector<HTMLInputElement>('[data-fin]')!;
    fin.value = '2026-11-30';
    fin.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(texte('[data-validation]')).toBe('Prévisions limitées à 16 jours');
    expect(el.querySelector<HTMLButtonElement>('[data-appliquer]')!.disabled).toBe(true);
    await cliquer('[data-appliquer]');
    expect(appliques).toEqual([]);
  });

  it('chargement : bouton « Chargement… » désactivé ; barre et compte des requêtes quand le serveur en annonce plusieurs', async () => {
    const { f, el, meteo, texte } = await monter();
    meteo.chargement.set(true);
    meteo.progression.set({ current: 1, total: 1 });
    await f.whenStable();
    expect(texte('[data-appliquer]')).toBe('Chargement…');
    expect(el.querySelector<HTMLButtonElement>('[data-appliquer]')!.disabled).toBe(true);
    expect(el.querySelector('[data-progression]')).toBeNull();
    meteo.progression.set({ current: 2, total: 5, etaMs: 61000 });
    await f.whenStable();
    expect(texte('[data-progression-texte]')).toBe('Chargement météo… 2/5 requêtes · ~2 min restant');
    expect(el.querySelector<HTMLElement>('[data-progression-barre]')!.style.width).toBe('40%');
  });

  it('erreur : le message dans le dialogue (masqué pendant un nouveau chargement)', async () => {
    const { f, meteo, texte } = await monter();
    meteo.erreur.set('HTTP 429 Trop de requêtes. Réessayez dans quelques instants.');
    await f.whenStable();
    expect(texte('[data-erreur]')).toBe('HTTP 429 Trop de requêtes. Réessayez dans quelques instants.');
    meteo.chargement.set(true);
    await f.whenStable();
    expect(texte('[data-erreur]')).toBeNull();
  });

  it('statistiques de la couche affichée', async () => {
    const { f, el, meteo, texte } = await monter();
    meteo.meta.set({
      variable: 'temperature_2m', unit: '°C', startDate: '', endDate: '', scale: 'departement', totalZones: 96, batchesTotal: 1, cachedAt: null,
      stats: { min: 8.04, max: 16.5, mean: 12.26, p20: 0, p40: 0, p60: 0, p80: 0, unit: '°C' },
    });
    await f.whenStable();
    expect(texte('[data-stats] .label')).toBe('Statistiques période');
    expect([...el.querySelectorAll('[data-stats] .stats > span')].map((s) => s.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(['min 8.0 °C', 'moy 12.3 °C', 'max 16.5 °C']);
  });

  it('Échap dans le dialogue : fermé, consommé (le panneau derrière reste ouvert)', async () => {
    const { el, fermetures, pile } = await monter();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    el.querySelector('[data-variable="precipitation"]')!.dispatchEvent(e);
    expect(fermetures).toEqual([1]);
    expect(e.defaultPrevented).toBe(true);
    expect(pile.etat().map((x) => x.id)).toEqual(['panneau', 'meteo']);
  });

  it('Échap reçu par la pile (hôte de la page) : c’est le dialogue qui se ferme, pas le panneau', async () => {
    const { pile, fermetures } = await monter();
    pile.fermerLePlusHaut();
    expect(fermetures).toEqual([1]);
    expect(pile.etat().map((x) => x.id)).toEqual(['panneau']);
  });

  it('détruit : retiré de la pile', async () => {
    const { f, pile } = await monter();
    f.destroy();
    expect(pile.etat().map((x) => x.id)).toEqual(['panneau']);
  });

  it('croix et voile ferment ; un clic DANS la boîte ne ferme pas', async () => {
    const { el, cliquer, fermetures } = await monter();
    await cliquer('[data-variable="windspeed_10m"]');
    expect(fermetures).toEqual([]);
    el.querySelector('dialog')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fermetures).toEqual([1]);
    await cliquer('[data-fermer]');
    expect(fermetures).toEqual([1, 1]);
  });
});

describe('validerPeriodeDialogue (MeteoGeoPanel.tsx:120-131)', () => {
  it('les cinq messages de React', () => {
    const t = '2026-10-10';
    expect(validerPeriodeDialogue('forecast', '2026-10-12', '2026-10-11', t)).toBe('Date de début postérieure à la date de fin');
    expect(validerPeriodeDialogue('forecast', '2026-10-01', '2026-10-09', t)).toBe("En mode prévisions, la date de fin doit être aujourd'hui ou plus tard");
    expect(validerPeriodeDialogue('forecast', t, '2026-10-27', t)).toBe('Prévisions limitées à 16 jours');
    expect(validerPeriodeDialogue('history', '2026-10-01', t, t)).toBe("En mode historique, la date de fin doit être avant aujourd'hui");
    expect(validerPeriodeDialogue('history', '2026-06-01', '2026-10-09', t)).toBe('Historique limité à 90 jours');
    expect(validerPeriodeDialogue('forecast', t, '2026-10-26', t)).toBeNull();
  });
});
