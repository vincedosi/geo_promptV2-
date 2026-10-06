import { TestBed } from '@angular/core/testing';
import { PuceFiltreComponent } from './puce-filtre.component';

describe('PuceFiltreComponent', () => {
  it('affiche le libellé du filtre, sous la barre du haut (56 px) à droite du rail (84 px) ; la croix émet `retirer`', async () => {
    const f = TestBed.createComponent(PuceFiltreComponent);
    f.componentRef.setInput('filtre', { type: 'departement', code: '13', label: '13 — Bouches-du-Rhône' });
    let retire = 0;
    f.componentInstance.retirer.subscribe(() => retire++);
    f.autoDetectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('13 — Bouches-du-Rhône');
    expect(el.style.top).toBe('56px');
    expect(el.style.left).toBe('84px');
    const croix = el.querySelector<HTMLButtonElement>('button[aria-label="Retirer le filtre"]')!;
    expect(croix.getAttribute('title')).toBe('Retirer le filtre');
    croix.click();
    expect(retire).toBe(1);
  });
});
