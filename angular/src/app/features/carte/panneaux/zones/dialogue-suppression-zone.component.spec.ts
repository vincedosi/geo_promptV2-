import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogueSuppressionZoneComponent } from './dialogue-suppression-zone.component';

@Component({
  imports: [DialogueSuppressionZoneComponent],
  template: `<mg-dialogue-suppression-zone nom="CIRFA BRETAGNE" [confirmer]="confirmer" (fermer)="fermetures = fermetures + 1" />`,
})
class Hote {
  fermetures = 0;
  readonly reponse = signal<((v: string | null) => void) | null>(null);
  /** Une suppression qui attend que le test la résolve. */
  readonly confirmer = () => new Promise<string | null>((r) => this.reponse.set(r));
}

async function monter() {
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const dialogue = (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
  return { fixture, dialogue, hote: fixture.componentInstance };
}

const echap = (cible: Element) => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  cible.dispatchEvent(e);
  return e;
};

describe('DialogueSuppressionZoneComponent (ZoneDeleteDialog.tsx, T14)', () => {
  it('Échap : CONSOMMÉ (le panneau derrière reste ouvert) et ferme le dialogue', async () => {
    const { dialogue, hote } = await monter();
    const e = echap(dialogue);
    expect(e.defaultPrevented).toBe(true);
    expect(hote.fermetures).toBe(1);
  });

  it('clic sur le voile (le <dialog> lui-même) ferme ; clic dans le contenu ne ferme pas', async () => {
    const { dialogue, hote } = await monter();
    (dialogue.querySelector('div') as HTMLElement).click();
    expect(hote.fermetures).toBe(0);
    dialogue.click();
    expect(hote.fermetures).toBe(1);
  });

  it('pendant la suppression : Échap, voile et boutons sans effet ; « Suppression... » ; échec affiché dans le dialogue', async () => {
    const { fixture, dialogue, hote } = await monter();
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await fixture.whenStable();
    expect(dialogue.querySelector('button[data-confirmer]')!.textContent?.trim()).toBe('Suppression...');
    expect(dialogue.querySelector<HTMLButtonElement>('button[data-annuler]')!.disabled).toBe(true);
    echap(dialogue);
    dialogue.click();
    expect(hote.fermetures).toBe(0);
    hote.reponse()!('HTTP 409');
    await fixture.whenStable();
    expect(dialogue.querySelector('[data-erreur]')!.textContent).toBe('HTTP 409');
    expect(dialogue.querySelector('button[data-confirmer]')!.textContent?.trim()).toBe('Supprimer');
  });
});
