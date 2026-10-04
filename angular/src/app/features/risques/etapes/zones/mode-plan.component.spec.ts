import { TestBed } from '@angular/core/testing';
import { LIBELLE_MODE, ModePlanComponent } from './mode-plan.component';

describe('ModePlanComponent', () => {
  it('deux boutons, l’actif pressé ; un clic émet le mode', async () => {
    const f = TestBed.createComponent(ModePlanComponent);
    f.componentRef.setInput('mode', 'pondere');
    const emis: string[] = [];
    f.componentInstance.modeChange.subscribe((m) => emis.push(m));
    await f.whenStable();
    const boutons = [...(f.nativeElement as HTMLElement).querySelectorAll('button')];
    expect(boutons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(boutons[1].textContent).toContain(LIBELLE_MODE.exclusif.aide);
    boutons[1].click();
    expect(emis).toEqual(['exclusif']);
  });
});
