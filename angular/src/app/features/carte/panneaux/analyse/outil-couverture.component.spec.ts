import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { formaterNombre } from '../../../../core/format/nombre';
import { Subject, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ProfilRisqueApi } from '../../../risques/data/profil-risque.api';
import { CouvertureService } from '../../couches/couverture.service';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import type { ResultatCouverture } from '../../logique/analyses/couverture';
import { croisementsFactices } from '../../testing/couverture-factice';
import { OutilCouvertureComponent } from './outil-couverture.component';

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BASE: ResultatCouverture = {
  zone_id: A, cible: 'ind', decoupage: 'forme', surface_km2: 5103.4, n_carreaux: 33100, population: 1906414, lignes: [],
  hors_territoire: { n_carreaux: 0, population: 0 }, n_territoires: 0, motif_vide: null, territoires_non_carroyes: [],
  reference: { source: 'carroyage', millesime: 2021, population_france: 63783569, n_carreaux_france: 2324577 },
  base_construite_le: '2026-10-22', calcule_le: '2026-10-22T10:00:00Z', cache: false, zone_maj: '2026-10-22T09:00:00+00:00',
};

/** Une doublure de `ZoneAnalyseeService` qui enregistre les gestes (le vrai est prouvé par sa propre spec, T7). */
function zoneFactice(zone: string | null) {
  const z = {
    zoneId: signal(zone), cible: signal('ind'), decoupage: signal<ResultatCouverture['decoupage']>('forme'),
    resultat: signal<ResultatCouverture | null>(null), enCours: signal(false), erreur: signal<string | null>(null),
    chiffrer: vi.fn(), choisir: vi.fn(), ...croisementsFactices(vi.fn()),
    regler: vi.fn((r: { cible?: string; decoupage?: ResultatCouverture['decoupage'] }) => {
      if (r.decoupage) z.decoupage.set(r.decoupage);
      if (r.cible) z.cible.set(r.cible);
      z.resultat.set(null);
    }),
  };
  return z;
}

async function monter(zone: string | null = A) {
  const z = zoneFactice(zone);
  const cibles = vi.fn(() => of({ cibles: [
    { code: 'ind', libelle: 'Population totale', famille: 'Ensemble' },
    { code: 'men_pauv', libelle: 'Ménages pauvres', famille: 'Ménages' },
  ] }));
  const listes = new Subject<{ zones: never[] }>();
  const couverture = {
    survole: signal(null), survoler: vi.fn(), chargementContours: signal(false), contoursIndisponibles: signal(false), irisSousLeZoom: signal(false),
    masquee: signal(false), afficher: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ZoneAnalyseeService, useValue: z },
      { provide: CouvertureService, useValue: couverture },
      { provide: ProfilRisqueApi, useValue: { cibles } },
      { provide: ZonesCustomApi, useValue: { lister: () => listes } },
      { provide: AuthService, useValue: { lireProfil: async () => ({ organisation: 'o1' }) } },
      { provide: CatalogueIndicateursService, useValue: { charger: () => of([]) } },
    ],
  });
  const f = TestBed.createComponent(OutilCouvertureComponent);
  const el = f.nativeElement as HTMLElement;
  const stable = async () => { await new Promise((r) => setTimeout(r, 0)); await f.whenStable(); };
  await stable();
  return { f, el, z, cibles, stable, couverture };
}

describe('mg-outil-couverture (lot 4, T8)', () => {
  it('ouvert par défaut ; aucune lecture de cibles ni chiffrage avant un geste', async () => {
    const { el, z, cibles } = await monter();
    expect(el.querySelector('[data-outil-couverture]')).not.toBeNull();
    expect(cibles).not.toHaveBeenCalled();
    expect(z.chiffrer).not.toHaveBeenCalled();
  });

  it('« Chiffrer la zone » : désactivé sans zone, un appel avec une zone', async () => {
    const sans = await monter(null);
    expect((sans.el.querySelector('[data-chiffrer]') as HTMLButtonElement).disabled).toBe(true);
    TestBed.resetTestingModule();
    const { el, z, stable } = await monter();
    (el.querySelector('[data-chiffrer]') as HTMLButtonElement).click();
    await stable();
    expect(z.chiffrer).toHaveBeenCalledTimes(1);
  });

  it('un refus s’affiche en une ligne AU-DESSUS du CTA', async () => {
    const { el, z, stable } = await monter();
    z.erreur.set('La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.');
    await stable();
    const erreur = el.querySelector('[data-erreur]')!;
    expect(erreur.textContent).toContain('trop vaste');
    expect(erreur.compareDocumentPosition(el.querySelector('[data-chiffrer]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('telle quelle : le chiffre de tête porte la phrase Filosofi (Q-J), sans tableau', async () => {
    const { el, z, stable } = await monter();
    z.resultat.set(BASE);
    await stable();
    const texte = el.querySelector('[data-resultat]')!.textContent!;
    expect(texte).toContain(formaterNombre(1906414));
    expect(texte).toContain('habitants carroyés');
    expect(texte).toContain('Population des carreaux Filosofi 2021 (63,78 M en France)');
    expect(el.querySelector('mg-tableau-couverture-zone')).toBeNull();
  });

  it('Guadeloupe : un message au lieu de « 0 » ; mer : son propre message', async () => {
    const { el, z, stable } = await monter();
    z.resultat.set({ ...BASE, population: 0, n_carreaux: 0, motif_vide: 'territoire_non_carroye', territoires_non_carroyes: [{ code: '971', nom: 'Guadeloupe' }] });
    await stable();
    expect(el.querySelector('[data-zone-vide]')!.textContent).toContain('ne couvre pas ce territoire (Guadeloupe)');
    expect(el.querySelector('mg-kpi')).toBeNull();
    z.resultat.set({ ...BASE, population: 0, n_carreaux: 0, motif_vide: 'aucun_carreau' });
    await stable();
    expect(el.querySelector('[data-zone-vide]')!.textContent).toContain('Aucun carreau habité');
  });

  // L'effacement RÉEL du résultat est prouvé par la spec de ZoneAnalyseeService (T7) ; ici, le câblage du clic.
  it('cliquer un découpage appelle regler({ decoupage }) et ne relance aucun chiffrage', async () => {
    const { el, z, stable } = await monter();
    z.resultat.set(BASE);
    await stable();
    (el.querySelector('[data-decoupage="cp"]') as HTMLButtonElement).click();
    await stable();
    expect(z.regler).toHaveBeenCalledWith({ decoupage: 'cp' });
    expect(el.querySelector('[data-resultat]')).toBeNull();
    expect(z.chiffrer).not.toHaveBeenCalled();
  });

  it('par CP : tableau, ligne hors code postal, « en cache »', async () => {
    const { el, z, stable } = await monter();
    z.resultat.set({
      ...BASE, decoupage: 'cp', n_territoires: 1, cache: true, hors_territoire: { n_carreaux: 12, population: 1786 },
      lignes: [{ code: '13100', nom: 'Aix-en-Provence', commune: null, n_carreaux: 10, pop_en_zone: 97172, pop_totale: 97172, part: 100 }],
    });
    await stable();
    expect(el.querySelector('[data-ligne="13100"]')).not.toBeNull();
    expect(el.querySelector('[data-hors-territoire]')!.textContent).toContain(`${formaterNombre(1786)} habitants hors code postal`);
    expect(el.querySelector('[data-calcule]')!.textContent).toContain('en cache');
    expect(el.querySelector('[data-reference]')!.textContent).toContain('propres habitants carroyés');
  });

  it('cible : le catalogue est lu à la première ouverture, une fois ; choisir règle la cible', async () => {
    const { el, z, cibles, stable } = await monter();
    (el.querySelector('[data-ouvrir-cible]') as HTMLButtonElement).click();
    await stable();
    expect(cibles).toHaveBeenCalledTimes(1);
    (el.querySelector('[data-cible="men_pauv"]') as HTMLButtonElement).click();
    await stable();
    expect(z.regler).toHaveBeenCalledWith({ cible: 'men_pauv' });
    expect(el.querySelector('[data-ouvrir-cible]')!.textContent).toContain('Ménages pauvres');
    (el.querySelector('[data-ouvrir-cible]') as HTMLButtonElement).click();
    await stable();
    expect(cibles).toHaveBeenCalledTimes(1);
  });

  it('T13 : « Dans cette zone » sous le résultat dès qu’une zone est choisie, sans lecture ; absent sans zone', async () => {
    const { el, z, stable } = await monter();
    z.resultat.set(BASE);
    await stable();
    const bloc = el.querySelector('mg-croisements-zone')!;
    expect(el.querySelector('[data-resultat]')!.compareDocumentPosition(bloc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(z.lireCroisements).not.toHaveBeenCalled();
    z.zoneId.set(null);
    await stable();
    expect(el.querySelector('mg-croisements-zone')).toBeNull();
  });

  it('T13, ronde 2 (I3) : la radio et le trafic refusés pour zone introuvable — la zone part, le message RESTE à l’écran', async () => {
    const { el, z, stable } = await monter();
    z.croisements.erreur.set('Zone introuvable dans cet espace.');
    await stable();
    expect(el.querySelectorAll('[data-erreur]')).toHaveLength(1); // zone présente : le bloc le dit, une seule fois
    z.zoneId.set(null);
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toContain('Zone introuvable dans cet espace');
  });

  it('Q2 : couche retirée de la carte → la ligne le dit, « Afficher sur la carte » la remet (sans re-chiffrer)', async () => {
    const { el, z, stable, couverture } = await monter();
    z.resultat.set(BASE);
    await stable();
    expect(el.querySelector('[data-couche-retiree]')).toBeNull();
    couverture.masquee.set(true);
    await stable();
    expect(el.querySelector('[data-couche-retiree]')!.textContent).toContain('Couche retirée de la carte.');
    (el.querySelector('[data-afficher-couche]') as HTMLButtonElement).click();
    await stable();
    expect(couverture.afficher).toHaveBeenCalledTimes(1);
    expect(z.chiffrer).not.toHaveBeenCalled();
  });
});
