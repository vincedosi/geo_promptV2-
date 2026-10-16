import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { CampagneOohService } from '../../couches/campagne-ooh.service';
import { PoisService } from '../../couches/pois.service';
import { CarteApi } from '../../data/carte.api';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import type { DetailCampagneOoh, ReponseCampagnesOoh } from '../../logique/campagnes-ooh';
import { DETAIL_ESSAI, ligneEssai } from '../../testing/campagnes-ooh.fixture';
import { SectionOohComponent } from './section-ooh.component';
import { SelectionsCalquesService } from './selections-calques.service';

const LISTE: ReponseCampagnesOoh = {
  campagnes: [{ id: 'c1', nom: 'Campagne essai', annonceur: null, vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', lignes: [
    { id: 'l1', ordre: 1, media: 'ooh', regie: 'REGIE', reseau: 'DOOH essai', territoire: null, nb_ecrans: 10, nb_places: 2, nb_non_places: 1 },
    { id: 'l2', ordre: 2, media: 'ooh', regie: 'OUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 10, nb_places: 0, nb_non_places: 0 },
  ] }],
  tronque: false,
};

const DETAIL: DetailCampagneOoh = {
  ...DETAIL_ESSAI,
  lignes: [
    ligneEssai('l1', 1, {
      nb_places: 2, nb_a_verifier: 1, nb_non_places: 1, nb_ecrans: 9,
      details: { nb_lieux_plan: 3, unite_lieux_plan: 'clubs', non_places: [{ nom: 'Club introuvable', raison: 'adresse introuvable (BAN)' }] },
    }),
    ligneEssai('l2', 2, { regie: 'OUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 200, format: '12m²', a_des_emplacements: false, nb_places: 0, nb_a_verifier: 0 }),
  ],
};

function monter(api: { campagnesOoh: () => unknown; campagneOoh?: (id: string) => unknown }) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CampagneOohService, SelectionsCalquesService, CouchesCarteService,
      { provide: CarteApi, useValue: { campagneOoh: () => new Subject(), ...api } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
      { provide: PoisService, useValue: { panneauSelectionne: signal(null) } },
    ],
  });
  const fixture = TestBed.createComponent(SectionOohComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, selections: TestBed.inject(SelectionsCalquesService), service: TestBed.inject(CampagneOohService) };
}

describe('SectionOohComponent — les campagnes OOH de l espace', () => {
  it('repliée à l ouverture : aucune lecture ; dépliée : la liste est lue UNE fois', async () => {
    const campagnesOoh = vi.fn(() => of(LISTE));
    const { el, rendre, selections } = monter({ campagnesOoh });
    await rendre();
    expect(campagnesOoh).not.toHaveBeenCalled();
    expect(el.querySelector('[data-contenu-ooh]')).toBeNull();
    selections.basculerSection('ooh');
    await rendre();
    selections.basculerSection('ooh');
    await rendre();
    selections.basculerSection('ooh');
    await rendre();
    expect(campagnesOoh).toHaveBeenCalledTimes(1);
  });

  it('espace sans campagne OOH : le dit', async () => {
    const { el, rendre, selections } = monter({ campagnesOoh: () => of({ campagnes: [], tronque: false }) });
    selections.basculerSection('ooh');
    await rendre();
    expect(el.querySelector('[data-aucune-campagne]')!.textContent!.trim()).toBe('Aucune campagne OOH dans cet espace de travail.');
  });

  it('la liste : nom, vague, période et lignes ; un clic lit la campagne', async () => {
    const campagneOoh = vi.fn(() => new Subject());
    const { el, rendre, selections } = monter({ campagnesOoh: () => of(LISTE), campagneOoh });
    selections.basculerSection('ooh');
    await rendre();
    const bouton = el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!;
    expect(bouton.textContent).toContain('Campagne essai');
    expect(bouton.textContent!.replace(/\s+/g, ' ')).toContain('V1 · 20/09/2026 → 02/10/2026 · 2 lignes');
    bouton.click();
    expect(campagneOoh).toHaveBeenCalledWith('c1');
    await rendre();
    expect(el.querySelector('[data-chargement-detail]')).not.toBeNull();
  });

  it('campagne choisie : une ligne par réseau avec sa teinte, l écart au plan, les points à vérifier, les non placés ; les DROM groupées', async () => {
    const { el, rendre, selections } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => of(DETAIL) });
    selections.basculerSection('ooh');
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!.click();
    await rendre();
    const ligne = el.querySelector('[data-ligne="l1"]')!;
    expect(ligne.querySelector('[data-pastille]')!.getAttribute('data-rang')).toBe('1');
    expect(ligne.textContent).toContain('REGIE · DOOH essai');
    expect(ligne.querySelector('[data-ecart]')!.textContent!.trim()).toMatch(/^2 clubs placés · plan : 3 clubs, 9 écrans$/);
    expect(ligne.querySelector('[data-a-verifier] summary')!.textContent!.trim()).toBe('1 à vérifier (cerne pointillé)');
    expect(ligne.querySelector('[data-non-places] summary')!.textContent!.trim()).toBe('1 emplacement non placé');
    expect(ligne.querySelector('[data-non-places] li')!.textContent).toContain('Club introuvable — adresse introuvable (BAN)');
    expect(el.querySelector('[data-ligne="l2"]')).toBeNull();
    const drom = el.querySelector('[data-sans-liste]')!;
    expect(drom.textContent).toContain('Liste des emplacements non fournie par la régie.');
    expect(drom.querySelector('[data-ligne-sans-liste="l2"]')!.textContent).toContain('OUTREMER · LA REUNION');
  });

  it('les points à vérifier sont listés (nom du lieu, libellé reconnu) ; un clic sur un nom ouvre sa fiche (pré-vol P6)', async () => {
    const { el, rendre, selections, service } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => of(DETAIL) });
    selections.basculerSection('ooh');
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!.click();
    await rendre();
    const bloc = el.querySelector<HTMLDetailsElement>('[data-ligne="l1"] [data-a-verifier]')!;
    expect(bloc.open).toBe(false);
    // Un seul emplacement `a_verifier` dans la ligne l1 de l'essai : p2 ; p1 (sûr) n'y est pas.
    const items = [...bloc.querySelectorAll('li')];
    expect(items).toHaveLength(1);
    expect(items[0].textContent!.replace(/\s+/g, ' ')).toContain('Lieu p2 — 1 Rue Essai 45000 Villetest');
    items[0].querySelector<HTMLButtonElement>('[data-ouvrir-emplacement="p2"]')!.click();
    expect(service.emplacementSelectionne()?.properties.id).toBe('p2');
  });

  it('décocher une ligne la masque ; « Toutes les campagnes » revient à la liste', async () => {
    const { el, rendre, selections, service } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => of(DETAIL) });
    selections.basculerSection('ooh');
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!.click();
    await rendre();
    el.querySelector<HTMLInputElement>('[data-ligne="l1"] [data-afficher-ligne]')!.click();
    await rendre();
    expect(service.masquees().has('l1')).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-retour-liste]')!.click();
    await rendre();
    expect(service.detail()).toBeNull();
    expect(el.querySelector('[data-choisir-campagne="c1"]')).not.toBeNull();
  });

  it('une lecture en échec est dite', async () => {
    const { el, rendre, selections } = monter({ campagnesOoh: () => throwError(() => new Error('Délai dépassé')) });
    selections.basculerSection('ooh');
    await rendre();
    expect(el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('! Délai dépassé');
    expect(el.querySelector('[data-erreur]')!.getAttribute('role')).toBe('alert');
  });

  it('liste tronquée par la route : le nombre dit est celui des campagnes listées, pas une borne recopiée', async () => {
    const campagnes = [LISTE.campagnes[0], { ...LISTE.campagnes[0], id: 'c2' }, { ...LISTE.campagnes[0], id: 'c3' }];
    const { el, rendre, selections } = monter({ campagnesOoh: () => of({ campagnes, tronque: true }) });
    selections.basculerSection('ooh');
    await rendre();
    expect(el.querySelector('[data-liste-tronquee]')!.textContent!.trim()).toBe('Plus de 3 campagnes : seules les 3 plus récentes sont listées.');
  });

  it('la lecture d une campagne en échec est dite au-dessus de la liste, toujours offerte', async () => {
    const { el, rendre, selections, service } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => throwError(() => ({ status: 404 })) });
    selections.basculerSection('ooh');
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!.click();
    await rendre();
    expect(service.detail()).toBeNull();
    expect(el.querySelector('[data-erreur-detail]')!.textContent!.trim()).toBe(`! ${service.erreurDetail()}`);
    expect(service.erreurDetail()).toBeTruthy();
    expect(el.querySelector('[data-choisir-campagne="c1"]')).not.toBeNull();
  });
});
