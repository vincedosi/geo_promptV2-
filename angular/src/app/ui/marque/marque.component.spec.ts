import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MarqueComponent } from './marque.component';

async function rendre() {
  const f = TestBed.createComponent(MarqueComponent);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('MarqueComponent (en-tête de barre, AppSidebar.tsx:164-204)', () => {
  it('assemble hexagone 28 px, logo 18 px de haut et signature', async () => {
    const el = await rendre();
    expect(el.querySelector('mg-hexagone svg')!.getAttribute('width')).toBe('28');
    const logo = el.querySelector('mg-logo') as HTMLElement;
    expect(logo.style.height).toBe('18px');
    expect(el.querySelector('p')!.textContent!.trim()).toBe('Geospatial intelligence');
  });

  it('signature : 11 px, tertiaire, poids 400, décalée de 36 px, 6 px sous la ligne', async () => {
    const el = await rendre();
    const p = el.querySelector('p')!;
    const cls = p.getAttribute('class')!;
    expect(cls).toContain('text-[11px]');
    expect(cls).toContain('text-tertiary');
    expect(cls).toContain('font-normal');
    expect(cls).toContain('mt-1.5');
    expect(cls).toContain('pl-[36px]');
  });
});
