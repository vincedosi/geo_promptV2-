import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of } from 'rxjs';
import { ChargementService } from '../../../../core/chargement/chargement.service';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from '../../../../graphiques/fabrique-graphique';
import { type Extraction, JeuxZonesApi } from '../../data/jeux-zones.api';
import { type EvenementSimulation, SimulationApi } from '../../data/simulation.api';
import { EtatRisqueService } from '../../etat/etat-risque.service';
import { SimulationService } from '../../etat/simulation.service';
import { ETAT_DEFAUT, type EtatRisque } from '../../logique/etat-url';
import type { ReponseSimulation } from '../../logique/simulation/payload';
import { reponseSimulation } from '../../testing/simulation.fixture';
import { DEFAUTS, PanneauCampagneComponent } from './panneau-campagne.component';

class GraphiqueFactice implements GraphiqueMinimal {
  options: Record<string, unknown>[] = [];
  setOption(o: unknown) { this.options.push(o as Record<string, unknown>); }
  resize() {}
  dispose() {}
}
class ObservateurFactice { observe() {} disconnect() {} }

const EXTRACTION = (version: number, origine: 'initiale' | 'recalage' = 'initiale', n = 1_234): Extraction => ({
  id: `e${version}`, version, origine, commentaire: '', seuil_couverture_cp: 20, mode_plan: 'pondere', n_cp: n,
  n_retenus: n, taux_utile: null, part_plan_en_zone: null, created_at: '',
});

const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const vider = () => new Promise((r) => setTimeout(r, 0));

interface Options {
  jeu?: string | null;
  reponse?: ReponseSimulation;
  extractions?: Extraction[] | 'erreur';
}

async function rendre(o: Options = {}) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  const etat = signal<EtatRisque>({ ...ETAT_DEFAUT, etape: 'campagne', jeu: o.jeu === undefined ? 'J' : o.jeu });
  const flux = new Subject<EvenementSimulation>();
  const lecture = signal<ReponseSimulation>(o.reponse ?? reponseSimulation('v1'));
  const simApi = {
    lire: vi.fn(() => of(lecture())),
    simuler: vi.fn(() => flux.asObservable()),
    recaler: vi.fn(() => flux.asObservable()),
    purger: vi.fn(() => of({})),
    exportSimulation: vi.fn(() => of()),
  };
  const extractions = vi.fn(() => (o.extractions === 'erreur'
    ? new Observable<never>((s) => s.error(new Error('x')))
    : of({ extractions: o.extractions ?? [EXTRACTION(2, 'recalage', 900), EXTRACTION(1)] })));
  const graphique = new GraphiqueFactice();
  TestBed.configureTestingModule({
    providers: [
      ChargementService, SimulationService,
      { provide: EtatRisqueService, useValue: { etat } },
      { provide: SimulationApi, useValue: simApi },
      { provide: JeuxZonesApi, useValue: { extractions } },
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => graphique },
      { provide: CouleursService, useValue: {
        palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, `couleur:${k}`])),
      } },
      { provide: ENREGISTRER_FICHIER, useValue: vi.fn() },
    ],
  });
  const service = TestBed.inject(SimulationService);
  service.activer();
  const f = TestBed.createComponent(PanneauCampagneComponent);
  await f.whenStable();
  await vider();
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const role = (r: string) => el.querySelector<HTMLElement>(`[data-role="${r}"]`);
  return { f, el, role, service, simApi, extractions, flux, graphique, lecture, etat };
}

describe('PanneauCampagneComponent', () => {
  it('sans jeu ouvert : le message de React, aucune lecture d’extractions', async () => {
    const { role, extractions } = await rendre({ jeu: null });
    expect([...role('sans-jeu')!.querySelectorAll('p')].map((p) => n(p.textContent))).toEqual([
      'Aucun jeu de zones ouvert',
      'Ouvrez un jeu enregistré à l’étape ④ Zones : la campagne diffuse sur le plan d’une de ses extractions.',
    ]);
    expect(extractions).not.toHaveBeenCalled();
  });

  it('jeu SANS extraction : « Aucune extraction » qui dit quoi faire, et aucun bouton Simuler', async () => {
    const { role, el } = await rendre({ extractions: [], reponse: { simulation: null } });
    expect([...role('sans-extraction')!.querySelectorAll('p')].map((p) => n(p.textContent))).toEqual([
      'Aucune extraction',
      'Extrayez d’abord le plan à l’étape ④ Zones (« Extractions pour le custom bidding ») : une campagne diffuse sur ce qui part au DSP, pas sur le jeu en cours de réglage.',
    ]);

    expect(role('simuler')).toBeNull();
    expect(el.querySelector('[data-role="aucune-simulation"]')).toBeNull();
  });

  it('une liste d’extractions illisible se lit « aucune extraction », comme React', async () => {
    const { role } = await rendre({ extractions: 'erreur', reponse: { simulation: null } });
    expect(role('sans-extraction')).not.toBeNull();
  });

  it('extractions : la dernière INITIALE par défaut, libellés de React ; aucune simulation → la phrase d’invite', async () => {
    const { el, role } = await rendre({ reponse: { simulation: null } });
    const options = [...el.querySelectorAll('option')];
    expect(options.map((o) => n(o.textContent))).toEqual(['v2 · recalage · 900 CP', 'v1 · initiale · 1 234 CP']);
    expect((role('extraction') as HTMLSelectElement).value).toBe('1');
    expect(n(role('simuler')?.textContent)).toBe('Simuler une campagne');
    expect(n(role('aucune-simulation')?.textContent)).toContain('Aucune campagne simulée sur ce jeu.');
  });

  it('changer de jeu remet la version choisie à zéro : la dernière initiale du NOUVEAU jeu (défaut React corrigé)', async () => {
    // React garde la version du jeu précédent (`setVersion((v) => v ?? …)`) : Simuler partirait sur une version que le
    // nouveau jeu n'a peut-être pas.
    const { f, el, role, etat, extractions, simApi } = await rendre({ reponse: { simulation: null } });
    expect((role('extraction') as HTMLSelectElement).value).toBe('1');
    extractions.mockImplementation(() => of({ extractions: [EXTRACTION(5)] }));
    etat.set({ ...etat(), jeu: 'K' });
    await f.whenStable();
    await vider();
    await f.whenStable();
    expect([...el.querySelectorAll('option')].map((o) => n(o.textContent))).toEqual(['v5 · initiale · 1 234 CP']);
    expect((role('extraction') as HTMLSelectElement).value).toBe('5');
    role('simuler')!.click();
    await f.whenStable();
    expect(simApi.simuler).toHaveBeenCalledWith('K', 5, DEFAUTS);
  });

  it('Simuler envoie la version choisie et les réglages ; la barre avance « N % · faites / total lignes », puis disparaît', async () => {
    const { f, role, simApi, flux } = await rendre({ reponse: { simulation: null } });
    role('simuler')!.click();
    await f.whenStable();
    expect(simApi.simuler).toHaveBeenCalledWith('J', 1, DEFAUTS);
    expect(n(role('progression')?.textContent)).toBe('Préparation de la simulation');
    expect((role('simuler') as HTMLButtonElement).disabled).toBe(true);
    flux.next({ etape: 'insertion', message: 'Insertion des impressions', faites: 31_000, total: 83_977, pourcentage: 37 });
    await f.whenStable();
    expect(n(role('pourcentage')?.textContent)).toBe('37 % · 31 000 / 83 977 lignes');
    const barre = role('progression')!.querySelector<HTMLElement>('.bg-teal')!;
    expect(barre.style.width).toBe('37%');
    flux.next({ etape: 'termine', message: 'Fini', simulation_id: 's', lignes: 83_977, duree_ms: 1 });
    flux.complete();
    await vider();
    await f.whenStable();
    expect(role('progression')).toBeNull();
    expect(simApi.lire).toHaveBeenCalledTimes(2);
  });

  it('les réglages : six curseurs aux bornes et formats de React ; la graine ramenée sous 100 000', async () => {
    const { el } = await rendre();
    const curseurs = [...el.querySelectorAll<HTMLInputElement>('details input[type="range"]')];
    expect(curseurs.map((c) => [c.getAttribute('aria-label'), c.min, c.max, c.step])).toEqual([
      ['Budget', '20000', '1000000', '10000'], ['Effet inventaire', '1', '2.2', '0.05'],
      ['Fuite hors zone', '0', '0.15', '0.005'], ['Bruit journalier', '0', '0.5', '0.02'],
      ['Force du recalage', '0', '1', '0.05'], ['Graine', '1', '99999', '1'],
    ]);
    const valeurs = [...el.querySelectorAll('details label .font-mono')].map((s) => n(s.textContent));
    expect(valeurs).toEqual(['250 000 €', '1,55', '4,0 %', '18 %', '80 %', '60924']);
  });

  it('simulation v1 : le résumé, Recaler, l’export et la purge à confirmer ; la période v2 est grisée', async () => {
    const { f, el, role, simApi, service } = await rendre();
    expect(n(role('resume')?.textContent)).toBe(
      'Campagne de 4 jours depuis le 24/09/2026, diffusée sur la v1 — semaines 1 et 2. Recalez pour diffuser les semaines 3 et 4 sur un plan corrigé.',
    );
    expect(n(role('simuler')?.textContent)).toBe('Relancer la simulation');
    expect(role('recaler')).not.toBeNull();
    expect(n(el.querySelector('mg-bouton-export')?.textContent)).toBe('Exporter en Excel');
    const periodes = [...el.querySelectorAll<HTMLButtonElement>('[role="group"] button')];
    expect(periodes.map((b) => n(b.textContent))).toEqual(['Semaines 1-2 · v1', 'Semaines 3-4 · v2', 'Toute la campagne']);
    expect(periodes[1].disabled).toBe(true);
    expect(periodes[1].getAttribute('title')).toBe('Recalez d’abord la campagne');
    // La période « tout » d'une simulation non recalée : la vue montre la campagne entière, les jours 1 à 4.
    expect(periodes[2].getAttribute('aria-pressed')).toBe('true');
    role('purger')!.click();
    await f.whenStable();
    expect(role('purger')).toBeNull();
    role('confirmer-purge')!.click();
    await f.whenStable();
    expect(simApi.purger).toHaveBeenCalledWith('J');
    expect(service.etat()).not.toBe('echec');
  });

  it('simulation v2 : pas de Recaler, résumé avec le jour du recalage, bilan v1 / v2, partenaires et sites', async () => {
    const { el, role } = await rendre({ reponse: reponseSimulation('v2') });
    expect(role('recaler')).toBeNull();
    expect(n(role('resume')?.textContent)).toBe(
      'Campagne de 4 jours depuis le 24/09/2026, diffusée sur la v1 puis, à partir du jour 3, sur la v2 recalée.',
    );
    const bilan = [...role('bilan')!.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => n(c.textContent)));
    expect(bilan[0]).toEqual(['Bilan', 'Semaines 1-2 · v1', 'Semaines 3-4 · v2']);
    expect(bilan.slice(1).map((l) => l[0])).toEqual(['Alignement', 'Part en zone', 'Taux d’utile', 'Coût par exposé touché']);
    expect(bilan[2]).toEqual(['Part en zone', '100,0 %', '100,0 %']);
    const partenaires = [...role('partenaires')!.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => n(c.textContent)));
    expect(partenaires.map((p) => p[0])).toEqual(['Partenaire A', 'Partenaire B']);
    expect(partenaires[0]).toEqual(['Partenaire A', '89,6 k', '4,46 €', '100,0 %', '44,4 %']);
    expect(n(role('sous-servis')?.textContent)).toMatch(/^Tous les sites|sites dans/);
    // Aucun badge « Simulation » (arbitrage React du 2026-09-24).
    expect(el.textContent).not.toMatch(/\bSimulation\b/);
  });

  it('la courbe : deux séries (v1 en --diverge-sous-2, v2 en --brand-teal), trou au recalage, repère « Recalage v2 »', async () => {
    const { graphique } = await rendre({ reponse: reponseSimulation('v2') });
    const o = graphique.options.at(-1) as {
      series: { name: string; data: [number, number | null][]; connectNulls: boolean; lineStyle: { color: string }; markLine?: { data: { xAxis: number }[]; label: { formatter: string } } }[];
      xAxis: { min: number; max: number; axisLabel: { customValues: number[]; formatter: (v: number) => string } };
      yAxis: { min: number; max: number; axisLabel: { customValues: number[] } };
    };
    expect(o.series.map((s) => s.lineStyle.color)).toEqual(['couleur:diverge-sous-2', 'couleur:brand-teal']);
    expect(o.series[0].data.map((p) => p[1] === null)).toEqual([false, false, true, true]);
    expect(o.series[1].data.map((p) => p[1] === null)).toEqual([true, true, false, false]);
    expect(o.series.every((s) => s.connectNulls === false)).toBe(true);
    expect(o.series[0].markLine!.data[0].xAxis).toBe(3);
    expect(o.series[0].markLine!.label.formatter).toBe('Recalage v2');
    expect([o.xAxis.min, o.xAxis.max]).toEqual([1, 4]);
    expect(o.xAxis.axisLabel.customValues).toEqual([1]);
    expect(o.xAxis.axisLabel.formatter(7)).toBe('j7');
    expect([o.yAxis.min, o.yAxis.max]).toEqual([0, 100]);
    expect(o.yAxis.axisLabel.customValues).toEqual([0, 25, 50, 75, 100]);
  });

  it('ce qu’il faut corriger : chiffré, jamais un adjectif', async () => {
    const { role } = await rendre({ reponse: reponseSimulation('v2') });
    const texte = n(role('corriger')?.textContent);
    expect(texte).toMatch(/Sur-pression · .+\. .+ impressions, soit .+ €, à redéployer\./);
    expect(texte).toMatch(/Sous-pression · .+\. Il manque .+ impressions pour tenir le plan, soit .+ €\./);
    expect(texte).toContain('Codes postaux les plus dilués · 13002 (10,0 % d’exposés)');
  });

  it('une erreur du flux s’affiche en rouge, sous la barre', async () => {
    const { f, role, flux } = await rendre();
    role('simuler')!.click();
    flux.next({ etape: 'erreur', message: 'Extraction introuvable.' });
    flux.complete();
    await vider();
    await f.whenStable();
    expect(n(role('erreur')?.textContent)).toBe('Extraction introuvable.');
    expect(role('erreur')!.getAttribute('role')).toBe('alert');
  });
});
