import { TestBed } from '@angular/core/testing';
import type { Check } from '../logique/types/admin';
import { CarteVerificationComponent } from './carte-verification.component';

function monter(check: Check): HTMLElement {
  const f = TestBed.createComponent(CarteVerificationComponent);
  f.componentRef.setInput('check', check);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('CarteVerificationComponent', () => {
  it('rend nom, statut, valeur et message (CheckCard, health/page.tsx:82-126)', () => {
    const el = monter({ name: 'MISTRAL_API_KEY', status: 'WARN', value: 'YN0BZE...', message: 'Cle Mistral presente' });
    expect(el.querySelector('[data-nom]')?.textContent?.trim()).toBe('MISTRAL_API_KEY');
    expect(el.querySelector('[data-statut]')?.textContent?.trim()).toBe('WARN');
    expect(el.querySelector('[data-valeur]')?.textContent?.trim()).toBe('YN0BZE...');
    expect(el.querySelector('[data-message]')?.textContent?.trim()).toBe('Cle Mistral presente');
    expect(el.querySelector('[data-carte]')?.getAttribute('data-etat')).toBe('WARN');
  });

  it('sans valeur : pas de ligne de valeur (React teste `check.value &&`)', () => {
    const el = monter({ name: 'TABLE_PROFILES', status: 'OK', message: 'Table accessible' });
    expect(el.querySelector('[data-valeur]')).toBeNull();
  });

  it('une icône par statut : coche, triangle, cercle barré', () => {
    expect(monter({ name: 'a', status: 'OK', message: '' }).querySelector('[data-icone="OK"]')).not.toBeNull();
    expect(monter({ name: 'b', status: 'WARN', message: '' }).querySelector('[data-icone="WARN"]')).not.toBeNull();
    expect(monter({ name: 'c', status: 'ERROR', message: '' }).querySelector('[data-icone="ERROR"]')).not.toBeNull();
  });
});
