import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Cellule, EnteteCellule } from './cellules';

@Component({
  imports: [EnteteCellule, Cellule],
  template: `
    <table><thead><tr>
      <th mgTh alignement="gauche">Territoire</th>
      <th mgTh explication="Somme des carreaux de 200 m">Habitants</th>
    </tr></thead>
    <tbody><tr><td mgTd fort>Total</td><td mgTd attenue>—</td></tr></tbody></table>`,
})
class Hote {}

describe('cellules de tableau', () => {
  it('garde la sémantique native et porte l\'explication en info-bulle', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const [gauche, aide] = Array.from((f.nativeElement as HTMLElement).querySelectorAll('th'));
    expect(gauche.classList).toContain('text-left');
    expect(aide.classList).toContain('text-right');
    expect(aide.getAttribute('title')).toBe('Somme des carreaux de 200 m');
    expect(aide.classList).toContain('cursor-help');
    expect(gauche.getAttribute('title')).toBeNull();
    const [fort, attenue] = Array.from((f.nativeElement as HTMLElement).querySelectorAll('td'));
    expect(fort.classList).toContain('text-primary');
    expect(attenue.classList).toContain('text-tertiary');
  });
});
