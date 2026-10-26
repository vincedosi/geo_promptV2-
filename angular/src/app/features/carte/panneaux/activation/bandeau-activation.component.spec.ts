import { TestBed } from '@angular/core/testing';
import { dateLot } from '../../logique/activation/bandeau';
import { preparerActivation } from '../../testing/activation-factice';
import { BandeauActivationComponent } from './bandeau-activation.component';

function rendre() {
  const banc = preparerActivation();
  TestBed.configureTestingModule({ providers: banc.fournisseurs });
  const f = TestBed.createComponent(BandeauActivationComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const tuiles = (): Record<string, [string, string]> => Object.fromEntries([...el.querySelectorAll('[data-kpi]')].map((k) => [
    k.getAttribute('data-kpi') ?? '', [k.querySelector('[data-role="valeur"]')!.textContent!.trim(), k.querySelector('[data-role="libelle"]')!.textContent!.trim()],
  ]));
  const rafraichir = () => { TestBed.tick(); f.detectChanges(); };
  return { ...banc, tuiles, rafraichir };
}

describe('mg-bandeau-activation (A-12)', () => {
  it('cinq tuiles : plateformes, prêtes, poussées, en erreur, dernière poussée', () => {
    const { activation, tuiles, rafraichir } = rendre();
    activation.bandeau.set({ plateformes: 4, pretes: 3, poussees: 1, enErreur: 1, derniere: dateLot('2026-10-26T09:00:00Z') });
    rafraichir();
    expect(tuiles()).toEqual({
      plateformes: ['4', 'Plateformes'], pretes: ['3', 'Prêtes'], poussees: ['1', 'Poussées'], erreur: ['1', 'En erreur'],
      derniere: [dateLot('2026-10-26T09:00:00Z'), 'Dernière poussée'],
    });
  });

  it('sans poussée : « — » pour la dernière', () => {
    const { tuiles } = rendre();
    expect(tuiles()['derniere']?.[0]).toBe('—');
  });

  it('M-1 : neutre tant que la lecture est en cours — aucun chiffre d’avant présenté comme celui de la campagne', () => {
    const { activation, tuiles, rafraichir } = rendre();
    activation.chargement.set(true); rafraichir();
    expect(Object.values(tuiles()).map(([v]) => v)).toEqual(['—', '—', '—', '—', '—']);
  });
});
