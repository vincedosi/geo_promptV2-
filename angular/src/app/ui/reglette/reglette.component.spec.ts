import { TestBed } from '@angular/core/testing';
import { RegletteComponent } from './reglette.component';

async function rendre() {
  const f = TestBed.createComponent(RegletteComponent);
  f.componentRef.setInput('libelle', 'Seuil haut');
  f.componentRef.setInput('valeur', 1000);
  f.componentRef.setInput('min', 100);
  f.componentRef.setInput('max', 10000);
  f.componentRef.setInput('pas', 100);
  f.componentRef.setInput('formater', (n: number) => (n >= 1000 ? `${n / 1000} km` : `${n} m`));
  const apercus: (number | null)[] = [];
  const validations: number[] = [];
  f.componentInstance.apercu.subscribe((v) => apercus.push(v));
  f.componentInstance.valider.subscribe((v) => validations.push(v));
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const curseur = el.querySelector('input[type="range"]') as HTMLInputElement;
  const glisser = async (v: number) => {
    curseur.value = String(v);
    curseur.dispatchEvent(new Event('input'));
    await f.whenStable();
  };
  const relacher = async () => {
    curseur.dispatchEvent(new Event('pointerup'));
    await f.whenStable();
  };
  return { f, el, curseur, glisser, relacher, apercus, validations };
}

describe('RegletteComponent', () => {
  it('prévisualise pendant le glissement, sans valider', async () => {
    const r = await rendre();
    await r.glisser(1500);
    await r.glisser(2000);
    expect(r.apercus).toEqual([1500, 2000]);
    expect(r.validations).toEqual([]);
    expect(r.el.textContent).toContain('2 km');
  });

  it('valide UNE fois au relâchement, puis éteint l\'aperçu', async () => {
    const r = await rendre();
    await r.glisser(2000);
    await r.relacher();
    expect(r.validations).toEqual([2000]);
    expect(r.apercus.at(-1)).toBeNull();
  });

  it('relâcher sans avoir bougé ne valide rien (aucun recalcul)', async () => {
    const r = await rendre();
    await r.relacher();
    r.curseur.dispatchEvent(new Event('blur'));
    await r.f.whenStable();
    expect(r.validations).toEqual([]);
  });

  it('après validation, l\'affichage retombe sur la valeur du parent, même corrigée', async () => {
    const r = await rendre();
    await r.glisser(3000);
    await r.relacher();
    r.f.componentRef.setInput('valeur', 2500); // le parent a arrondi ou refusé
    await r.f.whenStable();
    expect(r.curseur.value).toBe('2500');
    expect(r.el.textContent).toContain('2.5 km');
  });

  it('un « change » (relâchement hors de la poignée) valide une fois ; le pointerup suivant ne revalide pas', async () => {
    const r = await rendre();
    await r.glisser(4000);
    r.curseur.dispatchEvent(new Event('change'));
    await r.f.whenStable();
    await r.relacher();
    expect(r.validations).toEqual([4000]);
  });

  it('décrit sa plage aux lecteurs d\'écran', async () => {
    const r = await rendre();
    expect(r.curseur.getAttribute('aria-label')).toBe('Seuil haut, de 100 m à 10 km');
  });
});
