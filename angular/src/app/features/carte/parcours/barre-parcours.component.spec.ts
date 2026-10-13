import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { OrganisationsApi } from '../../session/data/organisations.api';
import { ETAPES_CARTE, LIBELLE_ETAPE_CARTE, etapesDuFil } from '../logique/parcours';
import { BarreParcoursComponent, HAUTEUR_BARRE_PARCOURS } from './barre-parcours.component';

/** Les fausses dépendances de `mg-badge-session`, comme `carte.page.spec.ts`. */
async function monter(entrees: { zoneScript?: string | null; planMedia?: number | null } = {}) {
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
    ],
  });
  const fixture = TestBed.createComponent(BarreParcoursComponent);
  fixture.componentRef.setInput('etapes', etapesDuFil({ filtrePose: false, calquesActifs: false }));
  fixture.componentRef.setInput('courante', 'perimetre');
  fixture.componentRef.setInput('segments', [{ cle: 'france', libelle: 'France entière' }, { cle: 'region:53', libelle: 'Bretagne' }]);
  if (entrees.zoneScript !== undefined) fixture.componentRef.setInput('zoneScript', entrees.zoneScript);
  if (entrees.planMedia !== undefined) fixture.componentRef.setInput('planMedia', entrees.planMedia);
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
      c.hasAttribute('data-tout-effacer') ? 'effacer' : c.hasAttribute('data-immersif') ? 'immersif' : c.tagName.toLowerCase());
    expect(blocs).toEqual(['mg-logo', 'mg-fil-ariane', 'div', 'effacer', 'immersif', 'mg-bascule-theme', 'mg-badge-session']);
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

  it('relaie choisir, remonter, toutEffacer, genererScript, rouvrirPlan, basculerImmersif, orgChangee', async () => {
    const { fixture, el } = await monter({ zoneScript: 'Brest', planMedia: 2 });
    const barre = fixture.componentInstance;
    // UN abonnement par sortie : chaque espion ne voit que la sienne.
    const espions = {
      choisir: vi.fn(), remonter: vi.fn(), toutEffacer: vi.fn(), genererScript: vi.fn(),
      rouvrirPlan: vi.fn(), basculerImmersif: vi.fn(), orgChangee: vi.fn(),
    };
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
  });
});
