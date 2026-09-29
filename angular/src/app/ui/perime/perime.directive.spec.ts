import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PerimeDirective } from './perime.directive';

@Component({
  imports: [PerimeDirective],
  template: '<div [mgPerime]="perime()"><button>Garder le clic</button></div>',
})
class Hote { readonly perime = signal(false); }

describe('PerimeDirective', () => {
  it('estompe sans bloquer les clics, et le dit aux lecteurs d\'écran', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const div = (f.nativeElement as HTMLElement).querySelector('div')!;
    expect(div.style.opacity).toBe('1');
    f.componentInstance.perime.set(true);
    await f.whenStable();
    expect(div.style.opacity).toBe('0.42');
    expect(div.getAttribute('aria-busy')).toBe('true');
    expect(div.style.pointerEvents).not.toBe('none');
  });
});
