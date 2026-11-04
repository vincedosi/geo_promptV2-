import { CaptureService } from '../../etat/capture.service';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subscription } from 'rxjs';
import { BatailleService } from '../../couches/bataille.service';
import { IsochronesApi } from '../../data/isochrones.api';
import { BatailleV2Service } from '../../etat/bataille-v2.service';
import { ContexteBatailleService } from '../../etat/contexte-bataille.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { OutilBatailleV2Component } from './outil-bataille-v2.component';

const CTX = { categorie: 'cirfa', mode: 'drive', territoire: { ville: '', regions: [], depts: ['13'] }, nbRegionsRef: 18 };

async function monter(zone = signal<string | null>(null), pays = false) {
  TestBed.configureTestingModule({
    providers: [CaptureService, 
      BatailleV2Service, BatailleService, CouchesCarteService,
      { provide: IsochronesApi, useValue: {
        verifierCache: () => of({ total_pois: 2, total_combos: 14, cached_combos: 7, missing_combos: 7, missing_pois: 1, cached_pois: 1 }),
      } },
      { provide: ContexteBatailleService, useValue: { contexte: signal(CTX), unPoi: signal(true), regions: signal([]), afficherPois: vi.fn(),
        oublierRefus: vi.fn(), sousBorne: (_c: unknown, _p: unknown, _n: unknown, suite: () => void) => { suite(); return Subscription.EMPTY; } } },
      { provide: ZoneAnalyseeService, useValue: { zoneId: zone, ligne: () => (zone() ? { id: zone(), recette: pays ? { type: 'pays' } : null } : null), siIntrouvable: () => false } },
    ],
  });
  const fixture = TestBed.createComponent(OutilBatailleV2Component);
  fixture.componentRef.setInput('ouvert', true);
  const emis: string[] = [];
  fixture.componentInstance.verifierCache.subscribe(() => emis.push('verifierCache'));
  fixture.componentInstance.lancer.subscribe((f) => emis.push(`lancer:${f}`));
  fixture.componentInstance.remplir.subscribe(() => emis.push('remplir'));
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  return { fixture, el, emis, v2: TestBed.inject(BatailleV2Service), bataille: TestBed.inject(BatailleService) };
}

const bouton = (el: HTMLElement, sel: string) => el.querySelector<HTMLButtonElement>(sel)!;

describe('OutilBatailleV2Component (BattleV2Tool.tsx, T17)', () => {
  it('entête, texte d’aide, sept paliers choisis par défaut', async () => {
    const { el } = await monter();
    expect(bouton(el, '[data-entete-outil]').textContent).toContain('Bataille V2 (multi-paliers)');
    expect(el.textContent).toContain('Lit le cache existant — aucun appel ORS. Paliers manquants skippés.');
    expect(el.textContent).toContain('Paliers — 10, 20, 30, 40, 50, 60, 90 min');
    expect([...el.querySelectorAll('[data-palier]')].map((b) => b.getAttribute('aria-pressed'))).toEqual(Array(7).fill('true'));
  });

  it('cache incomplet : « ✕ 1 POI manquants », barre, « Calculer 1 POI manquants (ORS) » qui émet', async () => {
    const { el, fixture, v2, emis } = await monter();
    v2.verifierCache();
    await fixture.whenStable();
    const s = el.querySelector('[data-statut-cache]')!.textContent!;
    expect(s).toContain('2 POIs · 14 isochrones');
    expect(s).toContain('✕ 1 POI manquants');
    expect(s).toContain('7/14 en cache · 7 à calculer');
    bouton(el, '[data-remplir]').click();
    expect(bouton(el, '[data-remplir]').textContent!.trim()).toBe('Calculer 1 POI manquants (ORS)');
    expect(emis).toEqual(['remplir']);
  });

  it('« Lancer » et « Forcer » oublient le statut du cache puis émettent', async () => {
    const { el, fixture, v2, emis } = await monter();
    v2.verifierCache();
    await fixture.whenStable();
    bouton(el, '[data-lancer]').click();
    expect(v2.cache()).toBeNull();
    bouton(el, '[data-forcer]').click();
    bouton(el, '[data-verifier-cache]').click();
    expect(emis).toEqual(['lancer:false', 'lancer:true', 'verifierCache']);
  });

  it('D-5 (04/11) : les boutons en sentence case, jamais en capitales — ni dans le texte, ni par une classe', async () => {
    const { el, fixture, v2 } = await monter();
    expect(bouton(el, '[data-verifier-cache]').textContent!.trim()).toBe('Vérifier le cache');
    expect(bouton(el, '[data-lancer]').textContent!.trim()).toBe('Lancer');
    expect(bouton(el, '[data-forcer]').textContent!.trim()).toBe('Forcer');
    v2.verifierCache();
    await fixture.whenStable();
    expect(bouton(el, '[data-remplir]').textContent!.trim()).toBe('Calculer 1 POI manquants (ORS)');
    for (const b of el.querySelectorAll('button')) {
      expect(b.classList.contains('uppercase'), b.textContent!).toBe(false);
      expect(b.textContent).not.toMatch(/VÉRIF|LANCER|FORCER|CALCUL|MANQUANTS|EN COURS/);
    }
  });

  it('bataille affichée : « Masquer » la cache et vide le journal', async () => {
    const { el, fixture, bataille } = await monter();
    bataille.visible.set(true);
    await fixture.whenStable();
    expect(bouton(el, '[data-entete-outil]').textContent).toContain('✓ Bataille V2 (multi-paliers)');
    bouton(el, '[data-masquer]').click();
    await fixture.whenStable();
    expect(bataille.visible()).toBe(false);
  });
});

/** ④ finitions (T7) : la bascule « Sur » de la bataille, montée seulement avec une zone analysée. */
describe('OutilBatailleV2Component — « Sur : la zone analysée »', () => {
  it('sans zone : pas de bascule ; avec : « La zone analysée » pressée, cache et remplissage inactifs avec leur raison', async () => {
    const sans = await monter();
    expect(sans.el.querySelector('mg-choix-sur-zone')).toBeNull();
    TestBed.resetTestingModule();
    const { el, fixture, v2 } = await monter(signal<string | null>('z-1'));
    expect(el.querySelector('mg-choix-sur-zone [data-pastille="zone"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(bouton(el, '[data-verifier-cache]').disabled).toBe(true);
    expect(el.querySelector('[data-cache-sur-zone]')!.textContent).toContain('lit le cache existant');
    v2.surZone.set(false);
    await fixture.whenStable();
    expect(bouton(el, '[data-verifier-cache]').disabled).toBe(false);
    expect(el.querySelector('[data-cache-sur-zone]')).toBeNull();
  });
});

/** ④ finitions (relecture 2) : sur une zone pays, « Lancer » est inactif et la phrase de la route est dite. */
describe('OutilBatailleV2Component — zone pays', () => {
  it('« Lancer » inactif, avec sa raison ; sur ①, il revient', async () => {
    const { el, fixture, v2 } = await monter(signal<string | null>('z-1'), true);
    expect(bouton(el, '[data-lancer]').disabled).toBe(true);
    expect(el.querySelector('[data-refus-pays]')!.textContent!.trim()).toBe('Sur toute la France, la bataille se lance depuis l’étape ① (France métropolitaine).');
    v2.surZone.set(false);
    await fixture.whenStable();
    expect(bouton(el, '[data-lancer]').disabled).toBe(false);
    expect(el.querySelector('[data-refus-pays]')).toBeNull();
  });
});
