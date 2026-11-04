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
    expect(svg.getAttribute('viewBox')).toBe('0 0 3840 812');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('dentsu.explore');
  });

  it('six lettres en currentColor, posé à --text-primary par l’hôte : noir en clair, blanc en sombre — sans filtre ni couleur en dur', async () => {
    const el = await rendre();
    const lettres = [...el.querySelectorAll('path[data-lettre]')].map((p) => p.getAttribute('data-lettre'));
    expect(lettres).toEqual(['d', 't', 'e', 'n', 's', 'u']);
    expect(el.querySelector('g')!.getAttribute('fill')).toBe('currentColor');
    expect(el.getAttribute('class')).toContain('text-primary');
    expect(el.querySelector('svg')!.getAttribute('style') ?? '').not.toContain('filter');
    expect(el.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('taille par la hauteur : 18 px de haut, largeur suivant le rapport (barre du haut de la carte, MapTopBar.tsx)', async () => {
    const f = TestBed.createComponent(LogoComponent);
    f.componentRef.setInput('hauteur', 18);
    await f.whenStable();
    const host = f.nativeElement as HTMLElement;
    expect(host.style.height).toBe('18px');
    expect(host.style.width).toBe('');
    expect(host.querySelector('svg')!.getAttribute('class')).toContain('h-full');
  });

  it('taille par la largeur : 240 px de large, hauteur suivant le rapport (catalogue ; jadis la page de connexion, supprimée le 2026-11-05)', async () => {
    const f = TestBed.createComponent(LogoComponent);
    f.componentRef.setInput('largeur', 240);
    await f.whenStable();
    const host = f.nativeElement as HTMLElement;
    expect(host.style.width).toBe('240px');
    expect(host.style.height).toBe('');
    expect(host.querySelector('svg')!.getAttribute('class')).toContain('w-full');
  });

  it('hauteur et largeur sont exclusives : les fixer ensemble lève (le rapport du viewBox serait faussé)', async () => {
    const f = TestBed.createComponent(LogoComponent);
    f.componentRef.setInput('hauteur', 18);
    f.componentRef.setInput('largeur', 240);
    await expect(f.whenStable()).rejects.toThrow(/exclusives/i);
  });
});
