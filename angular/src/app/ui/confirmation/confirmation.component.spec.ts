import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmationComponent } from './confirmation.component';

@Component({
  imports: [ConfirmationComponent],
  template: `
    <div (keydown)="toucheVueParLaPage = toucheVueParLaPage + 1">
      <mg-confirmation
        [ouvert]="ouvert()"
        titre="Supprimer la source"
        message="Cette action est irréversible."
        libelleConfirmer="Supprimer"
        [variante]="variante()"
        [enCours]="enCours()"
        (confirmer)="confirmations = confirmations + 1"
        (annuler)="annulations = annulations + 1; ouvert.set(false)"
      />
    </div>
  `,
})
class Hote {
  readonly ouvert = signal(false);
  readonly variante = signal<'danger' | 'defaut'>('defaut');
  readonly enCours = signal(false);
  confirmations = 0;
  annulations = 0;
  toucheVueParLaPage = 0;
}

/**
 * jsdom n'implémente ni `showModal` ni `close` : doublures qui reproduisent ce que fait le
 * navigateur (attribut `open`, événement `close`).
 */
let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
beforeEach(() => {
  showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true, writable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: close, configurable: true, writable: true });
});

async function monter() {
  const f = TestBed.createComponent(Hote);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { f, h: f.componentInstance, el, dialog: el.querySelector('dialog')! };
}

describe('ConfirmationComponent', () => {
  it('ouvert → showModal ; fermé → close', async () => {
    const { f, h, dialog } = await monter();
    expect(showModal).not.toHaveBeenCalled();
    h.ouvert.set(true);
    await f.whenStable();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.textContent).toContain('Supprimer la source');
    expect(dialog.textContent).toContain('Cette action est irréversible.');
    h.ouvert.set(false);
    await f.whenStable();
    expect(close).toHaveBeenCalled();
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('Échap : `cancel` empêché, `annuler` émis UNE fois, dialogue fermé, la page ne voit pas la touche', async () => {
    const { f, h, dialog } = await monter();
    h.ouvert.set(true);
    await f.whenStable();
    const touche = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    dialog.dispatchEvent(touche);
    const annulation = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(annulation);
    expect(annulation.defaultPrevented).toBe(true);
    await f.whenStable();
    expect(h.annulations).toBe(1);
    expect(h.toucheVueParLaPage).toBe(0);
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('un clic sur le fond annule, un clic dans la boîte non', async () => {
    const { f, h, dialog } = await monter();
    h.ouvert.set(true);
    await f.whenStable();
    (dialog.querySelector('[data-boite]') as HTMLElement).click();
    expect(h.annulations).toBe(0);
    dialog.click();
    await f.whenStable();
    expect(h.annulations).toBe(1);
  });

  it('Annuler et Confirmer émettent ; Annuler a le focus à l’ouverture', async () => {
    const { f, h, dialog } = await monter();
    h.ouvert.set(true);
    await f.whenStable();
    const [annuler, confirmer] = Array.from(dialog.querySelectorAll('button'));
    expect(annuler.textContent?.trim()).toBe('Annuler');
    expect(annuler.hasAttribute('autofocus')).toBe(true);
    expect(confirmer.textContent?.trim()).toBe('Supprimer');
    confirmer.click();
    expect(h.confirmations).toBe(1);
    annuler.click();
    expect(h.annulations).toBe(1);
  });

  it('enCours : boutons désactivés, « En cours... », Échap et fond sans effet', async () => {
    const { f, h, dialog } = await monter();
    h.ouvert.set(true);
    h.enCours.set(true);
    await f.whenStable();
    const [annuler, confirmer] = Array.from(dialog.querySelectorAll('button'));
    expect(annuler.disabled).toBe(true);
    expect(confirmer.disabled).toBe(true);
    expect(confirmer.textContent?.trim()).toBe('En cours...');
    const annulation = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(annulation);
    expect(annulation.defaultPrevented).toBe(true);
    dialog.click();
    expect(h.annulations).toBe(0);
  });

  it('variante danger : classe danger et pastille triangle ; défaut : ni l’une ni l’autre', async () => {
    const { f, h, dialog } = await monter();
    h.ouvert.set(true);
    await f.whenStable();
    const confirmer = () => Array.from(dialog.querySelectorAll('button'))[1];
    expect(confirmer().classList).not.toContain('danger');
    expect(dialog.querySelector('mg-icone[data-nom="triangle-alerte"]')).toBeNull();
    h.variante.set('danger');
    await f.whenStable();
    expect(confirmer().classList).toContain('danger');
    expect(dialog.querySelector('mg-icone[data-nom="triangle-alerte"]')).not.toBeNull();
  });

  it('une fermeture native (événement close sans cancel) resynchronise par `annuler`', async () => {
    const { f, h, dialog } = await monter();
    h.ouvert.set(true);
    await f.whenStable();
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
    await f.whenStable();
    expect(h.annulations).toBe(1);
  });
});
