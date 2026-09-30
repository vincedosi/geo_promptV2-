import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HexagoneComponent } from './hexagone.component';

@Component({
  imports: [HexagoneComponent],
  template: `<mg-hexagone [variante]="variante()" [taille]="taille()" />`,
})
class HoteComponent {
  readonly variante = signal<'marque' | 'cta'>('marque');
  readonly taille = signal<number | undefined>(undefined);
}

async function rendre() {
  const f = TestBed.createComponent(HoteComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement };
}

describe('HexagoneComponent', () => {
  it('variante marque : 28 px, viewBox 28, les trois tracés de la barre React (AppSidebar.tsx:170-190)', async () => {
    const { el } = await rendre();
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('28');
    expect(svg.getAttribute('height')).toBe('28');
    expect(svg.getAttribute('viewBox')).toBe('0 0 28 28');
    const paths = el.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute('d')).toBe('M14 2L25.5 8.5V19.5L14 26L2.5 19.5V8.5L14 2Z');
    expect(paths[0].getAttribute('stroke-width')).toBe('1');
    expect(paths[0].getAttribute('fill')).toBe('none');
    expect(paths[1].getAttribute('d')).toBe('M14 7L20.5 10.5V17.5L14 21L7.5 17.5V10.5L14 7Z');
    expect(paths[1].getAttribute('stroke-width')).toBe('0.5');
    expect(paths[1].getAttribute('fill-opacity')).toBe('0.06');
    const c = el.querySelector('circle')!;
    expect([c.getAttribute('cx'), c.getAttribute('cy'), c.getAttribute('r')]).toEqual(['14', '14', '2']);
    expect(c.getAttribute('opacity')).toBe('0.5');
  });

  it('variante marque : teal de marque par jeton, aucune couleur écrite en dur', async () => {
    const { el } = await rendre();
    el.querySelectorAll('path').forEach((p) => expect(p.getAttribute('class')).toContain('stroke-teal'));
    expect(el.querySelector('circle')!.getAttribute('class')).toContain('fill-teal');
    expect(el.innerHTML).not.toMatch(/#[0-9a-f]{3,6}|rgba?\(/i);
  });

  it('variante cta : 15 px, un seul contour trait 1,8 et un disque r 2,5, en currentColor (AppSidebar.tsx:223-226)', async () => {
    const { f, el } = await rendre();
    f.componentInstance.variante.set('cta');
    await f.whenStable();
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('15');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const paths = el.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('d')).toBe('M14 2L25.5 8.5V19.5L14 26L2.5 19.5V8.5L14 2Z');
    expect(paths[0].getAttribute('stroke')).toBe('currentColor');
    expect(paths[0].getAttribute('stroke-width')).toBe('1.8');
    const c = el.querySelector('circle')!;
    expect(c.getAttribute('r')).toBe('2.5');
    expect(c.getAttribute('fill')).toBe('currentColor');
    expect(c.getAttribute('opacity')).toBeNull();
  });

  it('la taille explicite prime sur celle de la variante', async () => {
    const { f, el } = await rendre();
    f.componentInstance.taille.set(40);
    await f.whenStable();
    expect(el.querySelector('svg')!.getAttribute('width')).toBe('40');
  });
});
