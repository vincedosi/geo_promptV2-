import { TestBed } from '@angular/core/testing';
import { LogoComponent } from './logo.component';

async function rendre() {
  const f = TestBed.createComponent(LogoComponent);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('LogoComponent', () => {
  it('est un SVG en ligne : aucune requête réseau, donc rien à résoudre contre le document hôte', async () => {
    const el = await rendre();
    expect(el.querySelector('img')).toBeNull();
    const svg = el.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 1600 360');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('MAGELIAN');
  });

  it('accents au teal EXACT de la marque, lettres à la couleur du texte — sans filtre ni dépendance à html.light', async () => {
    const el = await rendre();
    const accents = el.querySelectorAll('path[data-role="accent"]');
    const lettres = el.querySelectorAll('path[data-role="lettre"]');
    expect(accents.length).toBe(3);
    expect(lettres.length).toBe(7);
    accents.forEach((p) => expect(p.getAttribute('class')).toContain('fill-teal'));
    lettres.forEach((p) => expect(p.getAttribute('fill')).toBe('currentColor'));
    expect(el.querySelector('svg')!.getAttribute('style') ?? '').not.toContain('filter');
    // Aucune couleur écrite en dur dans le dessin.
    expect(el.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
