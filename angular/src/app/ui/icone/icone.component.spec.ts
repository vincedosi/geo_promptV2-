import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { IconeComponent } from './icone.component';
import { ICONES, type NomIcone } from './icones';

@Component({
  imports: [IconeComponent],
  template: `<mg-icone [nom]="nom()" [libelle]="libelle()" />`,
})
class HoteComponent {
  readonly nom = signal<NomIcone>('calques');
  readonly libelle = signal<string | undefined>(undefined);
}

@Component({
  imports: [IconeComponent],
  template: `<mg-icone nom="calques" [taille]="taille()" [trait]="trait()" />`,
})
class HoteAvecPropsComponent {
  readonly taille = signal(24);
  readonly trait = signal(2);
}

function monter() {
  const fixture = TestBed.createComponent(HoteComponent);
  fixture.detectChanges();
  const svg = () => fixture.nativeElement.querySelector('svg') as SVGElement;
  return { fixture, svg };
}

describe('mg-icone', () => {
  const noms = Object.keys(ICONES) as NomIcone[];

  it('porte les 43 tracés recensés dans les écrans React du lot', () => {
    expect(noms.length).toBe(43);
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
    expect(s.children.length).toBe(ICONES[nom].el.length);
    expect(s.namespaceURI).toBe('http://www.w3.org/2000/svg');
    for (const enfant of Array.from(s.children)) {
      expect(enfant.namespaceURI).toBe('http://www.w3.org/2000/svg');
    }
  });

  it('reprend les défauts de lucide : 24 px, trait 2', () => {
    const { svg } = monter();
    expect(svg().getAttribute('width')).toBe('24');
    expect(svg().getAttribute('height')).toBe('24');
    expect(svg().getAttribute('stroke-width')).toBe('2');
  });

  it('applique la taille et le trait passés, comme les props React', () => {
    const fixture = TestBed.createComponent(HoteAvecPropsComponent);
    fixture.componentInstance.taille.set(16);
    fixture.componentInstance.trait.set(1.5);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
  });

  it("ne pose pas shrink-0 sur l'hôte (lucide émet un svg nu)", () => {
    const { fixture } = monter();
    expect((fixture.nativeElement.querySelector('mg-icone') as HTMLElement).classList.contains('shrink-0')).toBe(false);
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
