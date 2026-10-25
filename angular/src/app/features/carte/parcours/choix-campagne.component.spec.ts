import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { NEVER, type Observable, Subject, of, throwError } from 'rxjs';
import { type CampagneListe, PlanApi } from '../data/plan.api';
import { MESSAGE_RESERVE_ADMIN } from '../etat/erreurs-campagnes';
import { PlanCampagneService } from '../etat/plan-campagne.service';
import { CAMPAGNE_A, CAMPAGNE_B, detailCampagne, planFactice } from '../testing/plan-factice';
import { ChoixCampagneComponent } from './choix-campagne.component';

const ligne = (id: string, name: string) => ({ id, name } as CampagneListe);

async function monter(campagnes: () => Observable<CampagneListe[]> = () => of([ligne(CAMPAGNE_A, 'Rentrée'), ligne(CAMPAGNE_B, 'Noël')])) {
  const plan = planFactice();
  const api = { campagnes: vi.fn(campagnes) };
  TestBed.configureTestingModule({ providers: [{ provide: PlanCampagneService, useValue: plan }, { provide: PlanApi, useValue: api }] });
  const fixture = TestBed.createComponent(ChoixCampagneComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stable = () => fixture.whenStable();
  const ouvrir = async () => { el.querySelector<HTMLButtonElement>('[data-declencheur-campagne]')!.click(); await stable(); };
  return { fixture, el, plan, api, stable, ouvrir };
}

describe('ChoixCampagneComponent — le sélecteur de la barre (⑥-⑧, A-1)', () => {
  it('aucune lecture avant le premier clic ; la liste n’est lue qu’UNE fois', async () => {
    const { el, api, ouvrir } = await monter();
    expect(api.campagnes).not.toHaveBeenCalled();
    expect(el.querySelector('[data-nom-campagne]')!.textContent!.trim()).toBe('Aucune');
    // Le déclencheur porte ses classes : la référence `#declencheur` masquait la propriété du même nom, et `[class]`
    // recevait l'élément (classe « __ngContext__ », bouton sans bordure ni espacement — preuve navigateur T7b).
    expect(el.querySelector('[data-declencheur-campagne]')!.classList).toContain('border-default');
    await ouvrir();
    expect(api.campagnes).toHaveBeenCalledTimes(1);
    expect([...el.querySelectorAll('[data-campagne]')].map((b) => b.textContent!.trim())).toEqual(['Rentrée', 'Noël']);
    // « Nouvelle campagne » EN TÊTE.
    expect(el.querySelector('[data-liste-campagnes] button')!.hasAttribute('data-nouvelle-campagne')).toBe(true);
    await ouvrir(); // ferme
    await ouvrir(); // rouvre
    expect(api.campagnes).toHaveBeenCalledTimes(1);
  });

  it('choisir une campagne passe par le service (seul écrivain de ?campagne=) et ferme la liste', async () => {
    const { el, plan, ouvrir, stable } = await monter();
    await ouvrir();
    el.querySelector<HTMLButtonElement>(`[data-campagne="${CAMPAGNE_B}"]`)!.click();
    await stable();
    expect(plan.choisirCampagne).toHaveBeenCalledWith(CAMPAGNE_B);
    expect(el.querySelector('[data-liste-campagnes]')).toBeNull();
    // Le nom affiché : celui de la liste, en attendant la campagne lue par le service — puis celle-ci.
    expect(el.querySelector('[data-nom-campagne]')!.textContent!.trim()).toBe('Noël');
    plan.detail.set(detailCampagne(CAMPAGNE_B, 'Noël 2026'));
    await stable();
    expect(el.querySelector('[data-nom-campagne]')!.textContent!.trim()).toBe('Noël 2026');
  });

  it('« Nouvelle campagne » : créée par le service, mise en tête de la liste, liste fermée', async () => {
    const { el, plan, ouvrir, stable } = await monter();
    const reponse = new Subject<{ id: string; name: string }>();
    plan.creerCampagne.mockReturnValue(reponse);
    await ouvrir();
    el.querySelector<HTMLButtonElement>('[data-nouvelle-campagne]')!.click();
    await stable();
    expect(el.querySelector('[data-nouvelle-campagne]')!.textContent!.trim()).toBe('Création…');
    const C = '16fd2706-8baf-433b-82eb-8c7fada847da';
    reponse.next({ id: C, name: 'Nouvelle campagne — 25/10/2026' });
    await stable();
    expect(el.querySelector('[data-liste-campagnes]')).toBeNull();
    await ouvrir();
    expect(el.querySelector('[data-campagne]')!.getAttribute('data-campagne')).toBe(C);
  });

  it('refus de rôle (403) : le message des administrateurs est DIT dans la liste', async () => {
    const { el, ouvrir } = await monter(() => throwError(() => new HttpErrorResponse({ status: 403 })));
    await ouvrir();
    expect(el.querySelector('[data-erreur-campagnes]')!.textContent!.trim()).toBe(MESSAGE_RESERVE_ADMIN);
    expect(el.querySelector('[data-aucune-campagne]')).toBeNull();
  });

  it('une campagne courante absente de la liste déjà lue (créée au hall) : relue à l’ouverture suivante', async () => {
    const { plan, api, ouvrir } = await monter();
    await ouvrir();
    await ouvrir();
    plan.campagne.set('16fd2706-8baf-433b-82eb-8c7fada847da');
    await ouvrir();
    expect(api.campagnes).toHaveBeenCalledTimes(2);
  });

  it('Échap ferme la liste et est consommé (la pile de la carte ne le voit pas)', async () => {
    const { el, ouvrir, stable } = await monter(() => NEVER);
    await ouvrir();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    el.querySelector('[data-liste-campagnes]')!.dispatchEvent(e);
    await stable();
    expect(e.defaultPrevented).toBe(true);
    expect(el.querySelector('[data-liste-campagnes]')).toBeNull();
  });

  it('sortie du focus : vers l’extérieur la liste se ferme, vers la liste elle reste ouverte (relecture 2, M-6)', async () => {
    const { el, ouvrir, stable } = await monter(() => NEVER);
    await ouvrir();
    const liste = el.querySelector<HTMLElement>('[data-liste-campagnes]')!;
    const declencheur = el.querySelector('[data-declencheur-campagne]')!;
    declencheur.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: liste }));
    await stable();
    expect(el.querySelector('[data-liste-campagnes]')).not.toBeNull();
    declencheur.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await stable();
    expect(el.querySelector('[data-liste-campagnes]')).toBeNull();
  });
});
