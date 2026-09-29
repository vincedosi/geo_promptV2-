import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChampComponent } from './champ.component';

@Component({
  imports: [ChampComponent],
  template: '<mg-champ libelle="Territoire"><select><option>France</option></select></mg-champ>',
})
class Hote {}

describe('ChampComponent', () => {
  it('lie le libellé au contrôle projeté par un <label>', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const label = (f.nativeElement as HTMLElement).querySelector('label')!;
    expect(label.textContent).toContain('Territoire');
    expect(label.querySelector('select')).not.toBeNull();
  });
});
