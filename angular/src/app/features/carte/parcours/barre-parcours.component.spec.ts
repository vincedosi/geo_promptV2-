import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { OrganisationsApi } from '../../session/data/organisations.api';
import { PlanApi } from '../data/plan.api';
import { PlanCampagneService } from '../etat/plan-campagne.service';
import { ETAPES_CARTE, LIBELLE_ETAPE_CARTE, etapesDuFil } from '../logique/parcours';
import { planFactice } from '../testing/plan-factice';
import { BarreParcoursComponent, HAUTEUR_BARRE_PARCOURS } from './barre-parcours.component';

/** Les fausses dépendances de `mg-badge-session`, comme `carte.page.spec.ts`. */
async function monter(entrees: { zoneScript?: string | null; planMedia?: number | null; autresOuvert?: boolean } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AuthService,
        useValue: {
          session: signal({ access_token: 'j', user: { email: 'a@exemple.test', user_metadata: {} } }),
          connecte: computed(() => true), email: computed(() => 'a@exemple.test'),
          lireRole: async () => null, deconnecter: async () => undefined,
          lireProfil: async () => ({ role: null, nom: null, organisation: null }),
          oublierProfil: () => undefined,
        },
      },
      { provide: OrganisationsApi, useValue: { lister: () => of({ organizations: [], active_org_id: null, is_super_admin: false }), changer: () => of() } },
      // Le sélecteur de campagne (⑥-⑧, lot 6) : son état et ses routes, jamais lues sans clic.
      { provide: PlanCampagneService, useValue: planFactice() },
      { provide: PlanApi, useValue: { campagnes: () => of([]) } },
    ],
  });
  const fixture = TestBed.createComponent(BarreParcoursComponent);
  fixture.componentRef.setInput('etapes', etapesDuFil({ filtrePose: false, calquesActifs: false, analyseAffichee: false, jeuRenseigne: false, planRenseigne: false }));
  fixture.componentRef.setInput('courante', 'perimetre');
  fixture.componentRef.setInput('segments', [{ cle: 'france', libelle: 'France entière' }, { cle: 'region:53', libelle: 'Bretagne' }]);
  if (entrees.zoneScript !== undefined) fixture.componentRef.setInput('zoneScript', entrees.zoneScript);
  if (entrees.planMedia !== undefined) fixture.componentRef.setInput('planMedia', entrees.planMedia);
  if (entrees.autresOuvert !== undefined) fixture.componentRef.setInput('autresOuvert', entrees.autresOuvert);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('BarreParcoursComponent', () => {
  it('rend le logo, le fil d’Ariane, les huit étapes dans l’ordre (celui du module risque, 13/10), Tout effacer, le mode immersif, le thème, la session', async () => {
    const { el } = await monter();
    expect(el.getAttribute('role')).toBe('banner');
    expect(el.style.height).toBe(`${HAUTEUR_BARRE_PARCOURS}px`);
    expect(el.querySelector('mg-logo')).not.toBeNull();
    expect(el.querySelector('mg-fil-ariane')).not.toBeNull();
    const etapes = [...el.querySelectorAll('mg-fil-etapes nav button')];
    expect(etapes).toHaveLength(8);
    // L'ordre ET les libellés exacts (Global Constraints) ; le rang précède le libellé.
    expect(etapes.map((b) => b.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(ETAPES_CARTE.map((e, i) => `${i + 1} ${LIBELLE_ETAPE_CARTE[e]}`));
    expect(etapes.map((b) => b.getAttribute('aria-current'))).toEqual(['step', null, null, null, null, null, null, null]);
    // Huit étapes tiennent dans la barre (T4c) : fil COMPACT, une ligne par étape, replié selon la largeur du conteneur.
    expect(el.querySelector('mg-fil-etapes')!.parentElement!.classList).toContain('@container');
    expect(etapes.every((b) => b.classList.contains('whitespace-nowrap'))).toBe(true);
    expect(el.querySelector('[data-tout-effacer]')!.textContent!.trim()).toBe('Tout effacer');
    expect(el.querySelector('[data-immersif]')!.getAttribute('aria-label')).toBe('Mode immersif');
    expect(el.querySelector('mg-bascule-theme')).not.toBeNull();
    expect(el.querySelector('mg-badge-session')).not.toBeNull();
    // L'ordre des blocs dans la barre : où je regarde, où j'en suis, puis ce qui vaut à toute étape.
    const blocs = [...el.children].map((c) =>
      c.hasAttribute('data-tout-effacer') ? 'effacer' : c.hasAttribute('data-immersif') ? 'immersif'
        : c.tagName.toLowerCase());
    expect(blocs).toEqual(['mg-logo', 'mg-fil-ariane', 'div', 'effacer', 'immersif', 'mg-bascule-theme', 'mg-badge-session']);
    // « Autres » suit le fil DANS son conteneur (T11b) : fil, filet, bouton — à côté des étapes, pas des actions.
    const conteneur = el.querySelector('mg-fil-etapes')!.parentElement!;
    // Écart serré (round 1 de T11b) : chaque pixel compte pour garder les 8 libellés à 1 440 px.
    expect(conteneur.classList).toContain('gap-1');
    expect(conteneur.classList).not.toContain('gap-1.5');
    expect([...conteneur.children].map((c) => c.hasAttribute('data-separateur-autres') ? 'filet' : c.hasAttribute('data-autres') ? 'autres' : c.tagName.toLowerCase()))
      .toEqual(['mg-fil-etapes', 'filet', 'autres']);
  });

  it('T11b « Autres » : au niveau des étapes mais HORS du fil — filet, pas de numéro, pas dans la liste des étapes', async () => {
    const { el } = await monter();
    const autres = el.querySelector<HTMLButtonElement>('[data-autres]')!;
    expect(autres.textContent!.trim()).toBe('Autres');
    expect(autres.getAttribute('aria-label')).toBe('Autres, hors parcours');
    expect(autres.getAttribute('type')).toBe('button');
    expect(autres.closest('nav')).toBeNull();
    expect(autres.closest('mg-fil-etapes')).toBeNull();
    expect(el.querySelectorAll('mg-fil-etapes nav button')).toHaveLength(8);
    expect(autres.getAttribute('aria-current')).toBeNull();
    expect(autres.getAttribute('aria-keyshortcuts')).toBeNull();
    // Le filet vertical : décoratif, `--border-subtle`.
    const filet = el.querySelector('[data-separateur-autres]')!;
    expect(filet.getAttribute('aria-hidden')).toBe('true');
    expect(filet.classList).toContain('bg-[var(--border-subtle)]');
    expect(filet.classList).toContain('w-px');
    // Le gabarit d'un bouton d'étape compact (hauteur 30, cible de 24 px au moins, 12 px, soulignement de 2 px).
    const etape = el.querySelectorAll<HTMLButtonElement>('mg-fil-etapes nav button')[1];
    for (const c of ['h-[30px]', 'min-w-6', 'text-[12px]', 'border-b-2', 'whitespace-nowrap', 'shrink-0', 'cursor-pointer']) {
      expect(etape.classList, `étape ${c}`).toContain(c);
      expect(autres.classList, `autres ${c}`).toContain(c);
    }
    // Fermé : l'apparence d'une étape non courante.
    expect(autres.classList).toContain('text-tertiary');
    expect(autres.classList).toContain('border-transparent');
  });

  it('T11b : « Autres » ouvert — état actif d’une étape courante, et AUCUNE étape n’est courante', async () => {
    const { el, fixture } = await monter({ autresOuvert: true });
    const autres = el.querySelector<HTMLButtonElement>('[data-autres]')!;
    expect(autres.getAttribute('aria-current')).toBe('true');
    for (const c of ['text-primary', 'border-teal', 'font-medium']) expect(autres.classList, c).toContain(c);
    expect(autres.classList).not.toContain('text-tertiary');
    expect([...el.querySelectorAll('mg-fil-etapes nav button')].map((b) => b.getAttribute('aria-current')).filter(Boolean)).toEqual([]);
    fixture.componentRef.setInput('autresOuvert', false);
    await fixture.whenStable();
    expect(autres.getAttribute('aria-current')).toBeNull();
    expect(el.querySelectorAll('mg-fil-etapes nav button')[0].getAttribute('aria-current')).toBe('step');
  });

  it('Script bidding DV360 et Plan média (n) n’existent que s’ils ont un objet', async () => {
    const sans = await monter({ zoneScript: null, planMedia: null });
    expect(sans.el.querySelector('[data-script-dv360]')).toBeNull();
    expect(sans.el.querySelector('[data-rouvrir-plan]')).toBeNull();
    // Défauts : les deux sont absents sans qu'on pose rien.
    TestBed.resetTestingModule();
    const defaut = await monter();
    expect(defaut.el.querySelector('[data-script-dv360]')).toBeNull();
    expect(defaut.el.querySelector('[data-rouvrir-plan]')).toBeNull();
    TestBed.resetTestingModule();
    const avec = await monter({ zoneScript: 'Brest', planMedia: 3 });
    const script = avec.el.querySelector<HTMLButtonElement>('[data-script-dv360]')!;
    expect(script.textContent!.trim()).toBe('Script bidding DV360');
    expect(script.getAttribute('title')).toBe('Générer le fichier custom bidding DV360 pour « Brest »');
    expect(avec.el.querySelector('[data-rouvrir-plan]')!.textContent!.trim()).toBe('Plan média (3)');
    // Et ils disparaissent quand leur objet s'en va.
    avec.fixture.componentRef.setInput('zoneScript', null);
    avec.fixture.componentRef.setInput('planMedia', null);
    await avec.fixture.whenStable();
    expect(avec.el.querySelector('[data-script-dv360]')).toBeNull();
    expect(avec.el.querySelector('[data-rouvrir-plan]')).toBeNull();
  });

  it('relaie choisir, remonter, toutEffacer, genererScript, rouvrirPlan, basculerImmersif, orgChangee, ouvrirAutres', async () => {
    const { fixture, el } = await monter({ zoneScript: 'Brest', planMedia: 2 });
    const barre = fixture.componentInstance;
    // UN abonnement par sortie : chaque espion ne voit que la sienne.
    const espions = {
      choisir: vi.fn(), remonter: vi.fn(), toutEffacer: vi.fn(), genererScript: vi.fn(),
      rouvrirPlan: vi.fn(), basculerImmersif: vi.fn(), orgChangee: vi.fn(), ouvrirAutres: vi.fn(),
    };
    barre.ouvrirAutres.subscribe(espions.ouvrirAutres);
    barre.choisir.subscribe(espions.choisir);
    barre.remonter.subscribe(espions.remonter);
    barre.toutEffacer.subscribe(espions.toutEffacer);
    barre.genererScript.subscribe(espions.genererScript);
    barre.rouvrirPlan.subscribe(espions.rouvrirPlan);
    barre.basculerImmersif.subscribe(espions.basculerImmersif);
    barre.orgChangee.subscribe(espions.orgChangee);

    el.querySelectorAll<HTMLButtonElement>('mg-fil-etapes nav button')[2].click();
    el.querySelector<HTMLButtonElement>('mg-fil-ariane button')!.click();
    el.querySelector<HTMLButtonElement>('[data-tout-effacer]')!.click();
    el.querySelector<HTMLButtonElement>('[data-script-dv360]')!.click();
    el.querySelector<HTMLButtonElement>('[data-rouvrir-plan]')!.click();
    el.querySelector<HTMLButtonElement>('[data-immersif]')!.click();
    el.querySelector<HTMLButtonElement>('[data-autres]')!.click();
    (fixture.debugElement.query(By.css('mg-badge-session')).componentInstance as { orgChangee: { emit(v: string | null): void } })
      .orgChangee.emit('org-2');

    // Le TROISIÈME bouton est ③ Zones depuis le 13/10 (Analyse est descendue à ④).
    expect(espions.choisir.mock.calls).toEqual([['zones']]);
    expect(espions.remonter.mock.calls).toEqual([[0]]);
    expect(espions.toutEffacer).toHaveBeenCalledTimes(1);
    expect(espions.genererScript).toHaveBeenCalledTimes(1);
    expect(espions.rouvrirPlan).toHaveBeenCalledTimes(1);
    expect(espions.basculerImmersif).toHaveBeenCalledTimes(1);
    expect(espions.orgChangee.mock.calls).toEqual([['org-2']]);
    expect(espions.ouvrirAutres).toHaveBeenCalledTimes(1);
  });

  it('le sélecteur de campagne : aux étapes ⑥ ⑦ ⑧ seulement, et pas sous « Autres » (lot 6, A-1)', async () => {
    const { fixture, el } = await monter();
    const present = async (courante: string, autres = false) => {
      fixture.componentRef.setInput('courante', courante);
      fixture.componentRef.setInput('autresOuvert', autres);
      await fixture.whenStable();
      return el.querySelector('mg-choix-campagne') !== null;
    };
    expect(await present('perimetre')).toBe(false);
    expect(await present('jeu')).toBe(false);
    expect(await present('plan')).toBe(true);
    expect(await present('activation')).toBe(true);
    expect(await present('live')).toBe(true);
    expect(await present('plan', true)).toBe(false);
  });
});
