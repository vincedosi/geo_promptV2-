import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { JeuxApi } from '../../data/jeux.api';
import { PlanApi } from '../../data/plan.api';
import { AnnonceService } from '../../etat/annonce.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { LancementCampagneService } from '../../etat/lancement-campagne.service';
import { ParcoursService } from '../../etat/parcours.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { MESSAGE_CAMPAGNE_INTROUVABLE, MESSAGE_RESERVE_ADMIN, PlanCampagneService } from '../../etat/plan-campagne.service';
import { CAMPAGNE_A, detailCampagne, planFactice } from '../../testing/plan-factice';
import { PanneauPlanComponent } from './panneau-plan.component';

/** La doublure du lancement (V-9) : son état seul, écriturable. */
function lancementFactice() {
  const etat = signal<{ campagne: string; statut: 'en_cours' } | null>(null);
  return { etat, enCours: computed(() => etat()?.statut === 'en_cours'), lancer: vi.fn(), oublier: vi.fn() };
}

async function monter(preparer: (p: ReturnType<typeof planFactice>) => void = () => undefined, lancement?: ReturnType<typeof lancementFactice>) {
  const plan = planFactice();
  preparer(plan);
  TestBed.configureTestingModule({
    providers: [
      { provide: PlanCampagneService, useValue: plan },
      { provide: PlanApi, useValue: { campagnes: () => NEVER, modeDemo: () => NEVER, organisationsCampagne: () => NEVER } },
      // La section Cible (T4) et sa source : jamais rendues ici.
      { provide: JeuxApi, useValue: { lister: () => NEVER } },
      { provide: JeuZonesService, useValue: { jeuId: signal(null), extraction: signal(null) } },
      EtatCarteService, AnnonceService,
      { provide: ParcoursService, useValue: { choisir: vi.fn() } },
      lancement ? { provide: LancementCampagneService, useValue: lancement } : LancementCampagneService, NotificationsService,
    ],
  });
  const fixture = TestBed.createComponent(PanneauPlanComponent);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, plan, etat: TestBed.inject(EtatCarteService), stable: () => fixture.whenStable() };
}

/** Une campagne ouverte, préremplie. */
const ouverte = (p: ReturnType<typeof planFactice>) => {
  p.campagne.set(CAMPAGNE_A);
  p.detail.set(detailCampagne(CAMPAGNE_A, 'Rentrée'));
  p.prerempli.set(true);
};

describe('PanneauPlanComponent — lancement en vol (revue finale, V-9)', () => {
  it('les trois sections sont grisées et inertes tant que le lancement de la campagne ouverte est en vol', async () => {
    const lancement = lancementFactice();
    const { el, stable } = await monter(ouverte, lancement);
    const sections = () => [...el.querySelectorAll('[data-corps-section]')];
    expect(sections()).toHaveLength(3);
    expect(sections().some((s) => s.hasAttribute('inert'))).toBe(false);
    lancement.etat.set({ campagne: CAMPAGNE_A, statut: 'en_cours' });
    await stable();
    expect(sections().every((s) => s.hasAttribute('inert') && s.classList.contains('opacity-50'))).toBe(true);
    // Le lancement d'une AUTRE campagne ne gèle pas celle-ci.
    lancement.etat.set({ campagne: '7c9e6679-7425-40de-944b-e07fc1f90ae7', statut: 'en_cours' });
    await stable();
    expect(sections().some((s) => s.hasAttribute('inert'))).toBe(false);
  });
});

describe('PanneauPlanComponent — le squelette de ⑥', () => {
  it('sans ?campagne= : le hall, et aucune section', async () => {
    const { el } = await monter();
    expect(el.querySelector('mg-hall-campagnes')).not.toBeNull();
    expect(el.querySelector('mg-entete-section')).toBeNull();
  });

  it('?campagne= d’un autre espace : le service a retiré le paramètre, le panneau DIT « introuvable » au-dessus du hall', async () => {
    const { el } = await monter((p) => p.erreur.set(MESSAGE_CAMPAGNE_INTROUVABLE));
    expect(el.querySelector('[data-erreur-plan]')!.textContent!.trim()).toBe(MESSAGE_CAMPAGNE_INTROUVABLE);
    expect(el.querySelector('mg-hall-campagnes')).not.toBeNull();
  });

  it('une campagne ouverte : « Création — <nom> », trois sections à bandeau dans l’ordre, le pied', async () => {
    const { el } = await monter(ouverte);
    expect(el.querySelector('mg-hall-campagnes')).toBeNull();
    expect(el.querySelector('[data-titre-plan]')!.textContent!.trim()).toBe('Création — Rentrée');
    expect([...el.querySelectorAll('mg-entete-section')].map((s) => s.textContent!.trim())).toEqual(['Cible', 'Plateformes et budget', 'Impressions prévues']);
    expect(el.querySelector('[data-recap-budget]')!.textContent!.trim()).toBe('—');
    expect(el.querySelector('[data-recap-periode]')!.textContent!.trim()).toBe('— → —');
  });

  it('une stratégie existe : « Modification — <nom> »', async () => {
    const { el } = await monter((p) => { ouverte(p); p.strategieExistante.set({ id: 's', statut: 'active' }); });
    expect(el.querySelector('[data-titre-plan]')!.textContent!.trim()).toBe('Modification — Rentrée');
  });

  it('« ← Choisir une autre campagne » ferme la campagne par le service', async () => {
    const { el, plan } = await monter(ouverte);
    el.querySelector<HTMLButtonElement>('[data-retour-hall]')!.click();
    expect(plan.choisirCampagne).toHaveBeenCalledWith(null);
  });

  it('bannière « Brouillon restauré (date) · Repartir de zéro »', async () => {
    const savedAt = '2026-10-24T09:30:00Z';
    const { el, plan } = await monter((p) => { ouverte(p); p.restaure.set({ savedAt }); });
    expect(el.querySelector('[data-brouillon-restaure]')!.textContent).toContain(`Brouillon restauré (${new Date(savedAt).toLocaleString('fr-FR')})`);
    el.querySelector<HTMLButtonElement>('[data-repartir-de-zero]')!.click();
    expect(plan.repartirDeZero).toHaveBeenCalled();
  });

  it('refus de rôle : le message est DIT, ni sections ni pied', async () => {
    const { el } = await monter((p) => { ouverte(p); p.accesRefuse.set(true); p.erreur.set(MESSAGE_RESERVE_ADMIN); });
    expect(el.querySelector('[data-erreur-plan]')!.textContent!.trim()).toBe(MESSAGE_RESERVE_ADMIN);
    expect(el.querySelector('mg-entete-section')).toBeNull();
    expect(el.querySelector('[data-pied-plan]')).toBeNull();
  });

  it('replier une section : l’étape du brouillon devient la section dépliée la plus basse (A-2)', async () => {
    const { el, plan, stable } = await monter(ouverte);
    const bandeau = (s: string) => el.querySelector<HTMLElement>(`mg-entete-section[data-section="${s}"]`)!;
    bandeau('impressions').click();
    await stable();
    expect(plan.definirEtape).toHaveBeenLastCalledWith(2);
    expect(el.querySelector('[data-corps-section="impressions"]')!.classList).toContain('hidden');
    bandeau('plateformes').click();
    await stable();
    expect(plan.definirEtape).toHaveBeenLastCalledWith(1);
  });

  it('note « filtre de carte » (A-8) : seulement quand un filtre de ① est posé', async () => {
    const { el, etat, stable } = await monter(ouverte);
    expect(el.querySelector('[data-note-filtre]')).toBeNull();
    etat.filtre.set({ type: 'departement', code: '29', label: 'Finistère' });
    await stable();
    expect(el.querySelector('[data-note-filtre]')!.textContent!.trim())
      .toBe('Un filtre de carte est actif. Il ne s’applique pas au plan : le plan couvre toute la campagne.');
  });

  it('note « filtre de carte » : jamais sur le hall (campagne fermée), comme React (relecture 2, M-1)', async () => {
    const { el, etat, stable } = await monter();
    etat.filtre.set({ type: 'departement', code: '29', label: 'Finistère' });
    await stable();
    expect(el.querySelector('mg-hall-campagnes')).not.toBeNull();
    expect(el.querySelector('[data-note-filtre]')).toBeNull();
  });
});
