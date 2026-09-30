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

  it('accents au vert du fichier du logotype (--logo-accent), lettres à la couleur du texte — sans filtre ni dépendance à html.light', async () => {
    const el = await rendre();
    const accents = el.querySelectorAll('path[data-role="accent"]');
    const lettres = el.querySelectorAll('path[data-role="lettre"]');
    expect(accents.length).toBe(3);
    expect(lettres.length).toBe(7);
    accents.forEach((p) => expect(p.getAttribute('class')).toContain('fill-logo-accent'));
    lettres.forEach((p) => expect(p.getAttribute('class')).toContain('fill-logo-lettre'));
    expect(el.querySelector('svg')!.getAttribute('style') ?? '').not.toContain('filter');
    // Aucune couleur écrite en dur dans le dessin.
    expect(el.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('taille par la hauteur : 18 px de haut, largeur suivant le rapport (barre latérale, AppSidebar.tsx:195)', async () => {
    const f = TestBed.createComponent(LogoComponent);
    f.componentRef.setInput('hauteur', 18);
    await f.whenStable();
    const host = f.nativeElement as HTMLElement;
    expect(host.style.height).toBe('18px');
    expect(host.style.width).toBe('');
    expect(host.querySelector('svg')!.getAttribute('class')).toContain('h-full');
  });

  it('taille par la largeur : 240 px de large, hauteur suivant le rapport (connexion, login/page.tsx:102)', async () => {
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
