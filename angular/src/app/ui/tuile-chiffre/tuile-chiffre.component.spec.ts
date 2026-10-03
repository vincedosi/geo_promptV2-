import { TestBed } from '@angular/core/testing';
import { TuileChiffreComponent } from './tuile-chiffre.component';

async function rendre(entrees: Record<string, unknown>) {
  const f = TestBed.createComponent(TuileChiffreComponent);
  for (const [k, v] of Object.entries(entrees)) f.componentRef.setInput(k, v);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('TuileChiffreComponent', () => {
  it("affiche l'icône 20 px, la valeur puis le libellé", async () => {
    const el = await rendre({ icone: 'horloge', valeur: '03/10', libelle: 'Expiration session' });
    expect(el.querySelector('svg')?.getAttribute('width')).toBe('20');
    const textes = Array.from(el.querySelectorAll('div')).map((d) => d.textContent);
    expect(textes).toEqual(['03/10', 'Expiration session']);
  });
  it('cliquable : curseur main et soulèvement au survol', async () => {
    const el = await rendre({ icone: 'horloge', valeur: 'v', libelle: 'l', cliquable: true });
    expect(el.className).toContain('cursor-pointer');
    expect(el.className).toContain('hover:-translate-y-px');
  });
  it('sinon, ni curseur ni soulèvement', async () => {
    const el = await rendre({ icone: 'horloge', valeur: 'v', libelle: 'l' });
    expect(el.className).not.toContain('cursor-pointer');
  });
});
