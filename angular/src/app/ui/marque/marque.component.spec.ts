import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MarqueComponent } from './marque.component';

async function rendre() {
  const f = TestBed.createComponent(MarqueComponent);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('MarqueComponent (en-tête de barre, AppSidebar.tsx)', () => {
  it('assemble le logo dentsu 20 px de haut et la signature, sans hexagone', async () => {
    const el = await rendre();
    const logo = el.querySelector('mg-logo') as HTMLElement;
    expect(logo.style.height).toBe('20px');
    expect(el.querySelector('mg-hexagone')).toBeNull();
    expect(el.querySelector('p')!.textContent!.trim()).toBe('Geospatial intelligence');
  });

  it('signature : 11 px, tertiaire, poids 400, 6 px sous le logo, alignée à gauche', async () => {
    const el = await rendre();
    const p = el.querySelector('p')!;
    const cls = p.getAttribute('class')!;
    expect(cls).toContain('text-[11px]');
    expect(cls).toContain('text-tertiary');
    expect(cls).toContain('font-normal');
    expect(cls).toContain('mt-1.5');
    expect(cls).not.toContain('pl-[36px]');
  });
});
