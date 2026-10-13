import { TestBed } from '@angular/core/testing';
import { CONSIGNE_ETAPE } from '../logique/parcours';
import { AideComponent, formaterRaccourci } from './aide.component';

describe('AideComponent — l’aide de l’étape et les raccourcis du parcours', () => {
  it('formaterRaccourci : « alt+1 » → « Alt + 1 »', () => {
    expect(formaterRaccourci('alt+1')).toBe('Alt + 1');
    expect(formaterRaccourci('ctrl+k')).toBe('Ctrl + K');
  });

  it('l’aide suit l’étape : « 4. Zones » et sa consigne ; puis 8 raccourcis, ①…⑦ et Échap, dérivés du parcours', async () => {
    const fixture = TestBed.createComponent(AideComponent);
    fixture.componentRef.setInput('etape', 'zones');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const aide = el.querySelector('[data-aide-etape]')!;
    expect(aide.querySelector('h4')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('4. Zones');
    expect(aide.textContent).toContain(CONSIGNE_ETAPE.zones);
    const lignes = [...el.querySelectorAll('[data-raccourci]')].map((l) => {
      const [nom, touches] = l.querySelectorAll(':scope > span');
      return [nom.textContent?.trim(), touches.textContent?.trim()];
    });
    expect(lignes).toEqual([
      ['1. Périmètre', 'Alt + 1'],
      ['2. Données', 'Alt + 2'],
      ['3. Analyse', 'Alt + 3'],
      ['4. Zones', 'Alt + 4'],
      ['5. Plan', 'Alt + 5'],
      ['6. Activation', 'Alt + 6'],
      ['7. Live', 'Alt + 7'],
      ['Fermer le tiroir, quitter le mode immersif', 'Échap'],
    ]);
    fixture.componentRef.setInput('etape', 'perimetre');
    await fixture.whenStable();
    expect(aide.querySelector('h4')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('1. Périmètre');
  });
});
