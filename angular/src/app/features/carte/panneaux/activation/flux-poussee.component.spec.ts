import { TestBed } from '@angular/core/testing';
import type { LigneFlux } from '../../data/activation.api';
import { preparerActivation } from '../../testing/activation-factice';
import { CAMPAGNE_A } from '../../testing/plan-factice';
import { FluxPousseeComponent, texteLigneFlux } from './flux-poussee.component';

describe('texteLigneFlux — les textes de React, statuts libellés et accordés (C-2)', () => {
  it('départ, cible (avec et sans erreur), fin', () => {
    expect(texteLigneFlux({ etape: 'debut', total: 3 }, 3)).toBe('Départ — 3 line items');
    expect(texteLigneFlux({ etape: 'cible', n: 1, total: 3, line_item_id: '11', statut: 'en_cours' }, 3)).toBe('[1/3] 11 · en cours');
    expect(texteLigneFlux({ etape: 'cible', n: 2, line_item_id: '12', statut: 'echec', erreur: 'Refusé' }, 3)).toBe('[2/3] 12 · échec — Refusé');
    expect(texteLigneFlux({ etape: 'fin', pousses: 2, echecs: 1 }, 3)).toBe('Terminé — 2 poussés, 1 échec');
    expect(texteLigneFlux({ etape: 'debut', total: 1 }, 1)).toBe('Départ — 1 line item');
    expect(texteLigneFlux({ etape: 'fin', pousses: 1, echecs: 0 }, 1)).toBe('Terminé — 1 poussé, 0 échec');
    expect(texteLigneFlux({ etape: 'cible', n: 1, total: 1, line_item_id: '11', statut: 'pousse' }, 1)).toBe('[1/1] 11 · poussé');
  });
});

describe('FluxPousseeComponent', () => {
  function rendre(flux: LigneFlux[]) {
    const banc = preparerActivation();
    TestBed.configureTestingModule({ providers: banc.fournisseurs });
    banc.activation.flux.set(flux);
    banc.activation.pousseeEnCours.set({ campagne: CAMPAGNE_A });
    const f = TestBed.createComponent(FluxPousseeComponent);
    f.detectChanges();
    return { ...banc, el: f.nativeElement as HTMLElement, f };
  }

  it('rien sans flux', () => {
    expect(rendre([]).el.querySelector('mg-entete-section')).toBeNull();
  });

  it('une ligne par étape, l’échec en rouge, la barre au rapport traités / total', () => {
    const { el } = rendre([
      { etape: 'debut', total: 2 },
      { etape: 'cible', n: 1, total: 2, line_item_id: '11', statut: 'en_cours' },
      { etape: 'cible', n: 1, line_item_id: '11', statut: 'echec', erreur: 'Refusé' },
    ]);
    const lignes = [...el.querySelectorAll('[data-lignes] > div')];
    expect(lignes.map((l) => l.textContent!.trim())).toEqual(['Départ — 2 line items', '[1/2] 11 · en cours', '[1/2] 11 · échec — Refusé']);
    expect(lignes[2].classList.contains('text-danger')).toBe(true);
    expect(el.querySelector('mg-entete-section')!.textContent).toContain('Poussée en cours');
    expect(el.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('1');
    expect(el.querySelector<HTMLElement>('[data-barre]')!.style.width).toBe('50%');
  });

  it('fin : barre pleine, « Poussée terminée » quand plus rien ne tourne', () => {
    const { el, activation, f } = rendre([{ etape: 'debut', total: 2 }, { etape: 'fin', pousses: 2, echecs: 0 }]);
    activation.pousseeEnCours.set(null); TestBed.tick(); f.detectChanges();
    expect(el.querySelector<HTMLElement>('[data-barre]')!.style.width).toBe('100%');
    expect(el.querySelector('mg-entete-section')!.textContent).toContain('Poussée terminée');
  });
});
