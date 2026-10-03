import { TestBed } from '@angular/core/testing';
import { EnteteSectionComponent } from './entete-section.component';

async function rendre(entrees: Record<string, unknown>) {
  const f = TestBed.createComponent(EnteteSectionComponent);
  for (const [k, v] of Object.entries(entrees)) f.componentRef.setInput(k, v);
  await f.whenStable();
  return f;
}

describe('EnteteSectionComponent', () => {
  it('pose le libellé et le point teal de 6 px', async () => {
    const f = await rendre({ libelle: 'Navigation rapide' });
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Navigation rapide');
    expect(el.querySelector('.bg-teal')?.classList).toContain('h-1.5');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.querySelector('mg-icone')).toBeNull();
  });

  it('repliable : bouton avec chevron, bascule au clic et au clavier', async () => {
    const f = await rendre({ libelle: 'S', repliable: true });
    const el = f.nativeElement as HTMLElement;
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('mg-icone')).not.toBeNull();
    el.click();
    await f.whenStable();
    expect(f.componentInstance.ouvert()).toBe(false);
    expect(el.getAttribute('aria-expanded')).toBe('false');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await f.whenStable();
    expect(f.componentInstance.ouvert()).toBe(true);
  });

  it('non repliable : un clic ne change rien', async () => {
    const f = await rendre({ libelle: 'S' });
    (f.nativeElement as HTMLElement).click();
    expect(f.componentInstance.ouvert()).toBe(true);
  });
});
