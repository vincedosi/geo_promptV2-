import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
import { JeuxApi } from '../../data/jeux.api';
import { PlanApi } from '../../data/plan.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { CAMPAGNE_A, CAMPAGNE_B, planFactice } from '../../testing/plan-factice';
import { SectionCibleComponent } from './section-cible.component';

async function monter() {
  const plan = planFactice();
  plan.campagne.set(CAMPAGNE_A);
  const api = {
    organisationsCampagne: vi.fn((id: string) => of({
      owner_organization_id: 'o1',
      organizations: id === CAMPAGNE_A
        ? [{ id: 'o1', name: 'Dentsu Lyon', slug: 'l', added_at: '', is_owner: true }, { id: 'o2', name: 'Client', slug: 'c', added_at: '', is_owner: false }]
        : [],
    })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlanCampagneService, useValue: plan },
      { provide: PlanApi, useValue: api },
      { provide: JeuxApi, useValue: { lister: () => NEVER } },
      { provide: JeuZonesService, useValue: { jeuId: signal(null), extraction: signal(null) } },
    ],
  });
  const fixture = TestBed.createComponent(SectionCibleComponent);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, plan, api, stable: () => fixture.whenStable() };
}

describe('SectionCibleComponent — identité de la campagne (port partiel de StepCible)', () => {
  it('nom, annonceur, produit : textes de React, saisis dans le brouillon par le service (jamais mutés)', async () => {
    const { el, plan, stable } = await monter();
    const champ = (c: string) => el.querySelector<HTMLInputElement>(`[data-champ="${c}"]`)!;
    expect(champ('name').placeholder).toBe('Nom affiché partout (sélecteur, suivi, exports)');
    expect(champ('advertiser').placeholder).toBe('Marque ou société annonceur');
    expect(champ('product').placeholder).toBe('Produit ou offre mis en avant');
    // Avant la fin du préremplissage : rien n'est éditable.
    expect(champ('name').disabled).toBe(true);
    plan.prerempli.set(true);
    await stable();
    const avant = plan.brouillon();
    champ('advertiser').value = 'Marque';
    champ('advertiser').dispatchEvent(new Event('input'));
    expect(plan.brouillon().advertiser).toBe('Marque');
    expect(avant.advertiser).toBe('');
    expect(el.textContent).toContain('Nom de la campagne');
    // Le panier de zones et l'indicateur à seuil ne sont pas portés (A-9).
    expect(el.textContent).not.toContain('Ma cible');
    expect(el.textContent).not.toContain('Construire une cible');
  });

  it('organisations : lues APRÈS le préremplissage, une fois par campagne ; vidées au changement de campagne', async () => {
    const { el, plan, api, stable } = await monter();
    expect(api.organisationsCampagne).not.toHaveBeenCalled();
    plan.prerempli.set(true);
    await stable();
    expect(api.organisationsCampagne).toHaveBeenCalledWith(CAMPAGNE_A);
    expect(el.querySelector('[data-noms-organisations]')!.textContent!.trim()).toBe('Dentsu Lyon (propriétaire) · Client');
    plan.prerempli.set(false);
    plan.campagne.set(CAMPAGNE_B);
    await stable();
    expect(el.querySelector('[data-noms-organisations]')).toBeNull();
    plan.prerempli.set(true);
    await stable();
    expect(api.organisationsCampagne).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-noms-organisations]')!.textContent!.trim()).toBe('Aucune');
  });
});
