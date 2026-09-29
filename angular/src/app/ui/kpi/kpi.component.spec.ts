import { TestBed } from '@angular/core/testing';
import { KpiComponent } from './kpi.component';

async function rendre(entrees: Record<string, unknown>) {
  const f = TestBed.createComponent(KpiComponent);
  for (const [k, v] of Object.entries(entrees)) f.componentRef.setInput(k, v);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('KpiComponent', () => {
  it('affiche la valeur, le libellé et la note', async () => {
    const el = await rendre({ valeur: '13 585 817', libelle: 'Habitants', note: 'Carroyage INSEE 2021' });
    expect(el.textContent).toContain('13 585 817');
    expect(el.textContent).toContain('Habitants');
    expect(el.textContent).toContain('Carroyage INSEE 2021');
  });
  it('met la valeur en accent sur demande', async () => {
    const el = await rendre({ valeur: '1', libelle: 'l', note: 'n', accent: true });
    expect(el.querySelector('[data-role="valeur"]')!.classList).toContain('text-teal');
  });
  it('taille 22 : valeur 22 px, libellé 11 px', async () => {
    const el = await rendre({ valeur: '1', libelle: 'l', note: 'n', taille: 22 });
    expect(el.querySelector('[data-role="valeur"]')!.classList).toContain('text-[22px]');
    expect(el.querySelector('[data-role="libelle"]')!.classList).toContain('text-[11px]');
  });
});
