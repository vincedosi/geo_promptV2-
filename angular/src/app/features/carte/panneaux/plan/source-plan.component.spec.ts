import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type Observable, Subject, of } from 'rxjs';
import { type ExtractionJeu, type JeuListe, JeuxApi } from '../../data/jeux.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { CAMPAGNE_A, planFactice } from '../../testing/plan-factice';
import { SourcePlanComponent } from './source-plan.component';

const J1 = '16fd2706-8baf-433b-82eb-8c7fada847da';
const J2 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const J3 = '6ba7b811-9dad-41d1-80b4-00c04fd430c8';

const jeu = (id: string, nom: string, type: JeuListe['type'], n_extractions = 1) => ({ id, nom, type, version: 2, n_extractions } as JeuListe);
const extraction = (id: string, version: number, plateformes: string[]): ExtractionJeu => ({
  id, version, origine: 'initiale', commentaire: '', seuil_couverture_cp: 30, mode_plan: 'exclusif', n_cp: 120, n_retenus: 87,
  taux_utile: 76.4, part_plan_en_zone: 91.2, created_at: '2026-10-24T09:00:00Z',
  plateformes: plateformes.map((p) => ({ plateforme: p, maille: 'cp', seuil: 30, rayon_m: null, n_unites: 87, taux_utile: 76.4 })),
} as ExtractionJeu);
const versions = (id: string, nom: string, extractions: ExtractionJeu[]) => ({ extractions, jeu: { id, nom, version: 2 } });

/** Canaux de la campagne : DV360 et TikTok disponibles (démo), Meta aussi. */
const CANAUX = {
  catalog: [
    { code: 'dv360', label: 'DV360', category: 'dsp' as const, connection_provider: null, active: true },
    { code: 'meta', label: 'Meta', category: 'social' as const, connection_provider: null, active: true },
    { code: 'tiktok', label: 'TikTok', category: 'social' as const, connection_provider: null, active: true },
  ],
  connectedProviders: [], is_demo: true, selected: { dsps: [], socials: [], ad_server: null },
};

interface Options {
  lister?: () => Observable<{ jeux: JeuListe[] }>;
  extractions?: (id: string) => Observable<unknown>;
  etape5?: { jeu: string | null; x: number | null };
}

async function monter(o: Options = {}) {
  const plan = planFactice();
  plan.campagne.set(CAMPAGNE_A);
  plan.canaux.set(CANAUX);
  const api = {
    lister: vi.fn(o.lister ?? (() => of({ jeux: [jeu(J1, 'Rentrée', 'zone'), jeu(J2, 'Seveso Rhône', 'risque'), jeu(J3, 'Brouillon', 'zone')] }))),
    extractions: vi.fn(o.extractions ?? ((id: string) => of(
      id === J1 ? versions(J1, 'Rentrée', [extraction('x2', 2, ['dv360', 'tiktok']), extraction('x1', 1, ['dv360', 'meta'])])
        : versions(id, id === J2 ? 'Seveso Rhône' : 'Brouillon', []),
    ))),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlanCampagneService, useValue: plan },
      { provide: JeuxApi, useValue: api },
      { provide: JeuZonesService, useValue: { jeuId: signal(o.etape5?.jeu ?? null), extraction: signal(o.etape5?.x ?? null) } },
    ],
  });
  const fixture = TestBed.createComponent(SourcePlanComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stable = () => fixture.whenStable();
  const cliquer = async (sel: string) => { el.querySelector<HTMLButtonElement>(sel)!.click(); await stable(); };
  return { el, plan, api, stable, cliquer };
}

describe('SourcePlanComponent — la cible V1 = une extraction figée (A-3)', () => {
  it('rien n’est lu avant la fin du préremplissage ; puis les jeux des DEUX types, badge Zone / Risque', async () => {
    const { el, plan, api, stable } = await monter();
    expect(api.lister).not.toHaveBeenCalled();
    plan.prerempli.set(true);
    await stable();
    expect(api.lister).toHaveBeenCalledTimes(1);
    expect([...el.querySelectorAll('[data-badge-type]')].map((b) => b.textContent!.trim())).toEqual(['Zone', 'Risque', 'Zone']);
    // Aucune version lue sans clic : la liste ne dit pas qui a des extractions.
    expect(api.extractions).not.toHaveBeenCalled();
  });

  it('un jeu dont les versions lues sont vides (extraction supprimée depuis la liste) est grisé lui aussi, avec l’endroit où le figer (étape ⑤ ou module risque)', async () => {
    const { el, plan, stable, cliquer } = await monter();
    plan.prerempli.set(true);
    await stable();
    await cliquer(`[data-jeu="${J3}"]`);
    await cliquer(`[data-jeu="${J2}"]`);
    const j3 = el.querySelector<HTMLButtonElement>(`[data-jeu="${J3}"]`)!;
    expect(j3.disabled).toBe(true);
    expect(j3.querySelector('[data-sans-extraction]')!.textContent!.trim()).toBe('Aucune extraction : figez-la à l’étape ⑤');
    expect(el.querySelector(`[data-jeu="${J2}"] [data-sans-extraction]`)!.textContent!.trim()).toBe('Aucune extraction : figez-la dans le module risque');
    expect(el.querySelector(`[data-jeu="${J1}"]`)!.hasAttribute('disabled')).toBe(false);
  });

  it('choisir une version : jeu + extraction au brouillon, plateformes PRÉ-COCHÉES (A-5), chiffres et phrase du plan', async () => {
    const { el, plan, stable, cliquer } = await monter();
    plan.prerempli.set(true);
    await stable();
    await cliquer(`[data-jeu="${J1}"]`);
    expect([...el.querySelectorAll('[data-extraction]')].map((b) => b.getAttribute('data-extraction'))).toEqual(['x2', 'x1']);
    await cliquer('[data-extraction="x1"]');
    expect(plan.brouillon().jeuZones).toEqual({ id: J1, nom: 'Rentrée', version: 2, extraction: { id: 'x1', version: 1 } });
    expect(plan.brouillon().channels).toEqual({ dsps: ['dv360'], socials: ['meta'], ad_server: null });
    expect(el.querySelector('[data-chiffres-extraction]')!.textContent!.replace(/\s+/g, ' ').trim())
      .toBe('— CP au plan, dont 87 retenus, taux d’utile 76,4 %, 91 % du plan en zone.');
    // V-4 : les CP au plan viennent de la lecture du bandeau (le plan CP entier de l'extraction).
    plan.cps.set(new Map([[`${J1}|1|`, { cp: [], total: 120 }]]));
    await stable();
    expect(el.querySelector('[data-chiffres-extraction]')!.textContent!.replace(/\s+/g, ' ').trim())
      .toBe('120 CP au plan, dont 87 retenus, taux d’utile 76,4 %, 91 % du plan en zone.');
    // V-3 : un jeu de ZONE n'a pas de classes, ce sont les multiplicateurs de son extraction.
    expect(el.querySelector('[data-phrase-plan]')!.textContent!.replace(/\s+/g, ' ').trim())
      .toBe('Le plan vient du jeu de zones Rentrée : ce sont les multiplicateurs de son extraction qui répartissent le budget.');
  });

  it('changer d’extraction RE-pré-coche les plateformes sans perdre les budgets saisis des plateformes restantes', async () => {
    const { plan, stable, cliquer } = await monter();
    plan.prerempli.set(true);
    await stable();
    await cliquer(`[data-jeu="${J1}"]`);
    await cliquer('[data-extraction="x1"]');
    plan.brouillon.update((d) => ({ ...d, channelBudgets: { dv360: 1500, meta: 600 }, cpmPrevus: { dv360: 5 } }));
    await stable();
    await cliquer('[data-extraction="x2"]');
    expect(plan.brouillon().channels).toEqual({ dsps: ['dv360'], socials: ['tiktok'], ad_server: null });
    expect(plan.brouillon().channelBudgets['dv360']).toBe(1500);
    expect(plan.brouillon().cpmPrevus).toEqual({ dv360: 5 });
    expect(plan.modifier).toHaveBeenCalledTimes(2);
  });

  it('?jeu=&x= de l’étape ⑤ : PROPOSÉ, jamais pris d’office ; pris au clic', async () => {
    const { el, plan, api, stable, cliquer } = await monter({ etape5: { jeu: J1, x: 2 } });
    plan.prerempli.set(true);
    await stable();
    expect(plan.brouillon().jeuZones).toBeNull();
    expect(plan.modifier).not.toHaveBeenCalled();
    expect(el.querySelector('[data-proposition]')!.textContent!.trim()).toBe('Partir de l’extraction ouverte à l’étape ⑤ : Rentrée v2');
    await cliquer('[data-proposition]');
    expect(api.extractions).toHaveBeenCalledWith(J1);
    expect(plan.brouillon().jeuZones?.extraction).toEqual({ id: 'x2', version: 2 });
    expect(el.querySelector('[data-proposition]')).toBeNull();
  });

  it('un brouillon qui a déjà son extraction : ses versions sont lues APRÈS la liste des jeux, et ses chiffres affichés', async () => {
    const liste = new Subject<{ jeux: JeuListe[] }>();
    const { el, plan, api, stable } = await monter({ lister: () => liste });
    plan.brouillon.update((d) => ({ ...d, jeuZones: { id: J1, nom: 'Rentrée', version: 2, extraction: { id: 'x1', version: 1 } } }));
    plan.prerempli.set(true);
    await stable();
    expect(api.extractions).not.toHaveBeenCalled();
    liste.next({ jeux: [jeu(J1, 'Rentrée', 'zone')] });
    await stable();
    expect(api.extractions).toHaveBeenCalledWith(J1);
    expect(el.querySelector('[data-extraction="x1"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[data-extraction-choisie]')).not.toBeNull();
  });

  it('un jeu SANS extraction (n_extractions = 0 de la liste) est grisé D’EMBLÉE, sans clic ni lecture (relecture 2)', async () => {
    const { el, plan, api, stable } = await monter({ lister: () => of({ jeux: [jeu(J1, 'Rentrée', 'zone'), jeu(J3, 'Brouillon', 'zone', 0)] }) });
    plan.prerempli.set(true);
    await stable();
    const j3 = el.querySelector<HTMLButtonElement>(`[data-jeu="${J3}"]`)!;
    expect(j3.disabled).toBe(true);
    expect(j3.querySelector('[data-sans-extraction]')!.textContent!.trim()).toBe('Aucune extraction : figez-la à l’étape ⑤');
    expect(api.extractions).not.toHaveBeenCalled();
  });

  it('proposition ?x= dont la version n’existe plus : dite, rien n’est choisi (relecture 2, M-4)', async () => {
    const { el, plan, stable, cliquer } = await monter({ etape5: { jeu: J1, x: 9 } });
    plan.prerempli.set(true);
    await stable();
    await cliquer('[data-proposition]');
    expect(plan.modifier).not.toHaveBeenCalled();
    expect(el.querySelector('[data-version-absente]')!.textContent!.trim()).toBe('La version v9 de ce jeu n’existe plus.');
  });
});
