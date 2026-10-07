import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { formaterNombre } from '../../../core/format/nombre';
import { ProgressionImportComponent } from './progression-import.component';

@Component({
  imports: [ProgressionImportComponent],
  template: `<mg-progression-import [etape]="etape()" [traitees]="traitees()" [total]="total()" [termine]="termine()" [echec]="echec()" />`,
})
class Hote {
  readonly etape = signal('Insertion');
  readonly traitees = signal<number | null>(null);
  readonly total = signal<number | null>(null);
  readonly termine = signal(false);
  readonly echec = signal<string | null>(null);
}

async function monter() {
  const f = TestBed.createComponent(Hote);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { f, h: f.componentInstance, el, barre: () => el.querySelector('[role="progressbar"]')! };
}

describe('ProgressionImportComponent', () => {
  it('sans total : barre INDÉTERMINÉE, aria-busy, aucune valeur inventée', async () => {
    const { f, h, el, barre } = await monter();
    expect(barre().getAttribute('aria-busy')).toBe('true');
    expect(barre().hasAttribute('aria-valuenow')).toBe(false);
    expect(el.querySelector('[data-indeterminee]')).not.toBeNull();
    expect(el.textContent).not.toContain('%');
    expect(el.textContent).toContain('Insertion');
    h.traitees.set(1250);
    await f.whenStable();
    expect(barre().hasAttribute('aria-valuenow')).toBe(false);
    expect(el.textContent).toContain(`${formaterNombre(1250)} lignes reçues`);
  });

  it('250 / 1 000 : aria-valuenow 25, texte « 250 / 1 000 », 25 %', async () => {
    const { f, h, el, barre } = await monter();
    h.traitees.set(250);
    h.total.set(1000);
    await f.whenStable();
    expect(barre().getAttribute('aria-valuenow')).toBe('25');
    expect(barre().getAttribute('aria-valuemin')).toBe('0');
    expect(barre().getAttribute('aria-valuemax')).toBe('100');
    expect(el.textContent).toContain(`Insertion — 250 / ${formaterNombre(1000)}`);
    expect(el.textContent).toContain('25%');
    expect((el.querySelector('[data-remplissage]') as HTMLElement).style.width).toBe('25%');
  });

  it('terminé : plus occupé, « ✓ Import terminé »', async () => {
    const { f, h, el, barre } = await monter();
    h.traitees.set(1000); h.total.set(1000); h.termine.set(true);
    await f.whenStable();
    expect(barre().getAttribute('aria-busy')).toBe('false');
    expect(el.textContent).toContain('✓ Import terminé');
    expect(el.querySelector('[data-remplissage]')!.classList).toContain('termine');
  });

  it('échec : message nommé, barre en danger, pas de 100 % inventé', async () => {
    const { f, h, el, barre } = await monter();
    h.traitees.set(300); h.total.set(1000); h.echec.set('Le flux s’est interrompu avant la fin.');
    await f.whenStable();
    expect(barre().getAttribute('aria-busy')).toBe('false');
    expect(el.textContent).toContain('! Le flux s’est interrompu avant la fin.');
    const r = el.querySelector('[data-remplissage]') as HTMLElement;
    expect(r.classList).toContain('echec');
    expect(r.style.width).toBe('30%');
  });

  it('échec sans total : aucune barre remplie', async () => {
    const { f, h, el } = await monter();
    h.echec.set('Refusé');
    await f.whenStable();
    expect(el.querySelector('[data-indeterminee]')).toBeNull();
    expect((el.querySelector('[data-remplissage]') as HTMLElement).style.width).toBe('0%');
  });
});
