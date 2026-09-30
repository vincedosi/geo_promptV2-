import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { IconeComponent } from './icone.component';
import { ICONES, type NomIcone } from './icones';

@Component({
  imports: [IconeComponent],
  template: `<mg-icone [nom]="nom()" [taille]="taille()" [trait]="trait()" [libelle]="libelle()" />`,
})
class HoteComponent {
  readonly nom = signal<NomIcone>('calques');
  readonly taille = signal(16);
  readonly trait = signal(1.5);
  readonly libelle = signal<string | undefined>(undefined);
}

function monter() {
  const fixture = TestBed.createComponent(HoteComponent);
  fixture.detectChanges();
  const svg = () => fixture.nativeElement.querySelector('svg') as SVGElement;
  return { fixture, svg };
}

describe('mg-icone', () => {
  const noms = Object.keys(ICONES) as NomIcone[];

  it('porte les 24 tracés recensés dans les écrans React du lot', () => {
    expect(noms.length).toBe(24);
  });

  it.each(noms)('rend « %s » en svg lucide 24 × 24', (nom) => {
    const { fixture, svg } = monter();
    fixture.componentInstance.nom.set(nom);
    fixture.detectChanges();
    const s = svg();
    expect(s.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(s.getAttribute('fill')).toBe('none');
    expect(s.getAttribute('stroke')).toBe('currentColor');
    expect(s.getAttribute('stroke-linecap')).toBe('round');
    expect(s.getAttribute('stroke-linejoin')).toBe('round');
    expect(s.children.length).toBe(ICONES[nom].length);
    expect(s.namespaceURI).toBe('http://www.w3.org/2000/svg');
    for (const enfant of Array.from(s.children)) {
      expect(enfant.namespaceURI).toBe('http://www.w3.org/2000/svg');
    }
  });

  it('applique la taille et le trait (1,5 par défaut)', () => {
    const { fixture, svg } = monter();
    expect(svg().getAttribute('width')).toBe('16');
    expect(svg().getAttribute('height')).toBe('16');
    expect(svg().getAttribute('stroke-width')).toBe('1.5');
    fixture.componentInstance.taille.set(20);
    fixture.componentInstance.trait.set(1.75);
    fixture.detectChanges();
    expect(svg().getAttribute('width')).toBe('20');
    expect(svg().getAttribute('height')).toBe('20');
    expect(svg().getAttribute('stroke-width')).toBe('1.75');
  });

  it('est décorative par défaut', () => {
    const { svg } = monter();
    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(svg().getAttribute('role')).toBeNull();
    expect(svg().getAttribute('aria-label')).toBeNull();
  });

  it('devient une image nommée avec un libellé', () => {
    const { fixture, svg } = monter();
    fixture.componentInstance.libelle.set('Calques');
    fixture.detectChanges();
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe('Calques');
    expect(svg().getAttribute('aria-hidden')).toBeNull();
  });

  it('refuse un nom inconnu à la compilation', () => {
    // @ts-expect-error — « inconnue » n'est pas un NomIcone
    const nom: NomIcone = 'inconnue';
    expect(Object.keys(ICONES)).not.toContain(nom);
  });
});
