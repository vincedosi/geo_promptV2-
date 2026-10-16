import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChoixFondComponent } from './choix-fond.component';

@Component({
  imports: [ChoixFondComponent],
  template: `<mg-choix-fond [fond]="fond()" (choisirFond)="choix.push($event)" />`,
})
class Hote {
  readonly fond = signal('liberty');
  readonly choix: string[] = [];
}

describe('ChoixFondComponent — le tiroir « Fond de carte » (ex-section Fond des Réglages)', () => {
  it('quatre fonds, le courant aria-pressed ; un clic émet son id', async () => {
    const fixture = TestBed.createComponent(Hote);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const fonds = [...el.querySelectorAll<HTMLButtonElement>('[data-fond]')];
    expect(fonds.map((b) => b.textContent?.trim())).toEqual(['Standard', 'OSM', 'Clair', 'dentsu']);
    expect(fonds.map((b) => b.getAttribute('data-fond'))).toEqual(['liberty', 'bright', 'positron', 'magelian']);
    expect(fonds.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    fonds[3].click();
    expect(fixture.componentInstance.choix).toEqual(['magelian']);
    fixture.componentInstance.fond.set('magelian');
    await fixture.whenStable();
    // Clair et dentsu partagent l'URL de Positron : un seul des deux est pressé (défaut React corrigé).
    expect(fonds.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true']);
  });
});
