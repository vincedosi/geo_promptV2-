import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PastilleComponent } from './pastille.component';

@Component({
  imports: [PastilleComponent],
  template: '<button mgPastille [actif]="actif()" (click)="actif.set(!actif())">Seuil haut</button>',
})
class Hote { readonly actif = signal(false); }

describe('PastilleComponent', () => {
  it('reste un vrai bouton, et dit son état', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const b = (f.nativeElement as HTMLElement).querySelector('button')!;
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    b.click();
    await f.whenStable();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.classList).toContain('text-teal');
  });
});
