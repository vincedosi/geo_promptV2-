import { TestBed } from '@angular/core/testing';
import { AideComponent, formaterRaccourci } from './aide.component';

describe('AideComponent — portage de HelpOverlay.tsx', () => {
  it('formaterRaccourci : « alt+1 » → « Alt + 1 », « ctrl+k » → « Ctrl + K »', () => {
    expect(formaterRaccourci('alt+1')).toBe('Alt + 1');
    expect(formaterRaccourci('ctrl+k')).toBe('Ctrl + K');
  });

  it("titre « Raccourcis clavier » puis une ligne par entrée à raccourci, dans l'ordre du rail, SANS l'Assistant", async () => {
    const fixture = TestBed.createComponent(AideComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h4')!.textContent?.trim()).toBe('Raccourcis clavier');
    const lignes = [...el.querySelectorAll('[data-raccourci]')].map((l) => {
      const [nom, touches] = l.querySelectorAll(':scope > span');
      return [nom.textContent?.trim(), touches.textContent?.trim()];
    });
    expect(lignes).toEqual([
      ['Campagne', 'Alt + C'],
      ['Filtre', 'Alt + 1'],
      ['Calques', 'Alt + 2'],
      ['Analyse', 'Alt + 3'],
      ['Zones', 'Alt + 4'],
    ]);
    expect(el.querySelectorAll('[data-raccourci] mg-icone').length).toBe(5);
  });
});
