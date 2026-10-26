import { TestBed } from '@angular/core/testing';
import { dateHeureFr } from '../../../../core/format/date';
import { lotDe, preparerActivation } from '../../testing/activation-factice';
import { HistoriqueActivationComponent, detailLot } from './historique-activation.component';

/** jsdom n'implémente ni `showModal` ni `close` : doublures (patron de `confirmation.component.spec.ts`). */
beforeEach(() => {
  const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  const close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true, writable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: close, configurable: true, writable: true });
});

function rendre() {
  const banc = preparerActivation();
  TestBed.configureTestingModule({ providers: banc.fournisseurs });
  const f = TestBed.createComponent(HistoriqueActivationComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rafraichir = () => { TestBed.tick(); f.detectChanges(); };
  return { ...banc, el, rafraichir };
}

describe('HistoriqueActivationComponent', () => {
  it('vide : « Aucune activation pour cette campagne. »', () => {
    expect(rendre().el.querySelector('[data-aucun-lot]')!.textContent!.trim()).toBe('Aucune activation pour cette campagne.');
  });

  it('un lot : canal, statut (libellé + point), « Simulé », date fr-FR, détail', () => {
    const { el, activation, rafraichir } = rendre();
    activation.lots.set([lotDe({ mode: 'simule', statut: 'partiel', cibles: { pousse: 1, echec: 1 } })]); rafraichir();
    const lot = el.querySelector('[data-lot="l1"]')!;
    expect(lot.querySelector('[data-canal]')!.textContent!.trim()).toBe('Google DV360');
    expect(lot.querySelector('[data-statut]')!.textContent!.trim()).toBe('Partiel');
    expect(lot.querySelector('[data-statut] span')!.classList.contains('bg-warning')).toBe(true);
    expect(lot.querySelector('[data-simule]')!.textContent!.trim()).toBe('Simulé');
    expect(lot.querySelector('[data-date]')!.textContent!.trim()).toBe(dateHeureFr('2026-10-26T09:00:00Z'));
    expect(lot.querySelector('[data-detail]')!.textContent!.trim()).toBe('v1 · 2 line items · 1 pousse · 1 echec');
  });

  it('detailLot : sans version, un seul line item (React)', () => {
    expect(detailLot(lotDe({ version_strategie: null, n_cibles: 1, cibles: { pousse: 1 } }))).toBe('1 line item · 1 pousse');
  });

  it('« Annuler ce lot » → confirmation « Marquer ce lot annulé ? » → le service ; « Non » referme', () => {
    const { el, activation, rafraichir } = rendre();
    activation.lots.set([lotDe()]); rafraichir();
    el.querySelector<HTMLButtonElement>('[data-annuler-lot]')!.click(); rafraichir();
    const dialogue = el.querySelector('dialog')!;
    expect(dialogue.textContent).toContain('Marquer ce lot annulé ?');
    const [non, confirmer] = [...dialogue.querySelectorAll<HTMLButtonElement>('button')];
    expect(non.textContent!.trim()).toBe('Non');
    non.click(); rafraichir();
    expect(activation.annuler).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>('[data-annuler-lot]')!.click(); rafraichir();
    confirmer.click(); rafraichir();
    expect(activation.annuler).toHaveBeenCalledWith('l1');
  });

  it('un lot annulé n’a pas de bouton ; le message de la route est affiché tel quel', () => {
    const { el, activation, rafraichir } = rendre();
    activation.lots.set([lotDe({ statut: 'annule' })]);
    activation.messageAnnulation.set('Le lot est marqué annulé dans dentsu.explore.'); rafraichir();
    expect(el.querySelector('[data-annuler-lot]')).toBeNull();
    expect(el.querySelector('[data-statut]')!.textContent!.trim()).toBe('Annulé');
    expect(el.querySelector('[data-message-annulation]')!.textContent!.trim()).toBe('Le lot est marqué annulé dans dentsu.explore.');
  });
});
