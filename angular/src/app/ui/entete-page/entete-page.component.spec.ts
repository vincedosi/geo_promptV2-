import { TestBed } from '@angular/core/testing';
import { EntetePageComponent } from './entete-page.component';

async function rendre(entrees: Record<string, unknown>) {
  const f = TestBed.createComponent(EntetePageComponent);
  for (const [k, v] of Object.entries(entrees)) f.componentRef.setInput(k, v);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('EntetePageComponent', () => {
  it('titre en h1 18 px, interlettrage -0,02 em, et sous-titre', async () => {
    const el = await rendre({ titre: 'Dashboard', sousTitre: 'Bienvenue' });
    const h1 = el.querySelector('h1')!;
    expect(h1.textContent).toBe('Dashboard');
    expect(h1.className).toContain('text-[18px]');
    expect(h1.className).toContain('tracking-[-0.02em]');
    expect(el.querySelector('p')?.textContent).toBe('Bienvenue');
  });
  it('sans sous-titre, aucun paragraphe', async () => {
    expect((await rendre({ titre: 'T' })).querySelector('p')).toBeNull();
  });
});
