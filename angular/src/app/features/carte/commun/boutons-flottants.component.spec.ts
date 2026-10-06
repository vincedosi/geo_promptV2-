import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BoutonsFlottantsComponent } from './boutons-flottants.component';

@Component({
  imports: [BoutonsFlottantsComponent],
  template: `<mg-boutons-flottants [railMasque]="masque()" [haut]="masque() ? 10 : 52" (basculerImmersif)="immersif = immersif + 1" (toutEffacer)="effacer = effacer + 1" />`,
})
class Hote {
  readonly masque = signal(false);
  immersif = 0;
  effacer = 0;
}

describe('BoutonsFlottantsComponent — mode immersif et Tout effacer (page.tsx:1334-1376)', () => {
  it('« Tout effacer » 42 px sous le bouton immersif, gomme 16 px, titre de React ; chaque clic émet', async () => {
    const fixture = TestBed.createComponent(Hote);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const immersif = el.querySelector<HTMLButtonElement>('button[data-immersif]')!;
    const effacer = el.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!;
    expect(immersif.style.top).toBe('52px');
    expect(effacer.style.top).toBe('94px');
    expect(effacer.getAttribute('title')).toBe('Tout effacer (couches et zones affichées)');
    expect(effacer.querySelector('mg-icone svg')!.getAttribute('width')).toBe('16');
    effacer.click();
    immersif.click();
    expect(fixture.componentInstance.effacer).toBe(1);
    expect(fixture.componentInstance.immersif).toBe(1);
    fixture.componentInstance.masque.set(true);
    await fixture.whenStable();
    expect(effacer.style.top).toBe('52px');
    expect(immersif.getAttribute('aria-pressed')).toBe('true');
  });
});
