import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { WizardStep } from '../logique/lots';
import { texte } from '../testing/aides';
import { EtapesComponent } from './etapes.component';

@Component({
  imports: [EtapesComponent],
  template: '<mg-shapefile-etapes [etape]="etape()" [verrouille]="verrouille()" (choisir)="choisies.push($event)" />',
})
class Hote {
  readonly etape = signal<WizardStep>(1);
  readonly verrouille = signal(false);
  readonly choisies: WizardStep[] = [];
}

describe('EtapesComponent — fil d’étapes (`Stepper.tsx`, lot 6, T14)', () => {
  async function monter(n: WizardStep) {
    const f = TestBed.createComponent(Hote);
    f.componentInstance.etape.set(n);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    return { f, el, boutons: [...el.querySelectorAll<HTMLButtonElement>('button[data-etape]')] };
  }

  it('étape 1 : « 1 Fichiers » courante, « 2 Mapping » et « 3 Import » désactivées, filets éteints', async () => {
    const { el, boutons } = await monter(1);
    expect(boutons.map((b) => texte(b))).toEqual(['1 Fichiers', '2 Mapping', '3 Import']);
    expect(boutons.map((b) => b.disabled)).toEqual([false, true, true]);
    expect(boutons.map((b) => b.getAttribute('aria-current'))).toEqual(['step', null, null]);
    expect([...el.querySelectorAll('.filet')].map((d) => d.classList.contains('atteint'))).toEqual([false, false]);
  });

  it('étape 3 : les étapes franchies portent ✓ et ramènent en arrière ; l’étape courante ne fait rien', async () => {
    const { f, el, boutons } = await monter(3);
    expect(boutons.map((b) => texte(b))).toEqual(['✓ Fichiers', '✓ Mapping', '3 Import']);
    expect(boutons.map((b) => b.disabled)).toEqual([false, false, false]);
    expect([...el.querySelectorAll('.filet')].map((d) => d.classList.contains('atteint'))).toEqual([true, true]);
    boutons[2].click();
    boutons[0].click();
    boutons[1].click();
    expect(f.componentInstance.choisies).toEqual([1, 2]);
  });

  it('verrouillé (envoi en cours) : les étapes franchies sont désactivées et ne ramènent nulle part (B4)', async () => {
    const { f, boutons } = await monter(3);
    f.componentInstance.verrouille.set(true);
    await f.whenStable();
    expect(boutons.map((b) => b.disabled)).toEqual([true, true, false]);
    boutons[0].click();
    expect(f.componentInstance.choisies).toEqual([]);
  });
});
