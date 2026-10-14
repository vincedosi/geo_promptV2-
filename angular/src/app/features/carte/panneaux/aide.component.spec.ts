import { TestBed } from '@angular/core/testing';
import { CONSIGNE_AUTRES, CONSIGNE_ETAPE } from '../logique/parcours';
import { AideComponent, formaterRaccourci } from './aide.component';

describe('AideComponent — l’aide de l’étape et les raccourcis du parcours', () => {
  it('formaterRaccourci : « alt+1 » → « Alt + 1 »', () => {
    expect(formaterRaccourci('alt+1')).toBe('Alt + 1');
    expect(formaterRaccourci('ctrl+k')).toBe('Ctrl + K');
  });

  it('T11b : « Autres » ouvert → l’aide de « Autres » (hors parcours, sans numéro), pas celle de l’étape d’en dessous', async () => {
    const fixture = TestBed.createComponent(AideComponent);
    fixture.componentRef.setInput('etape', 'autres');
    await fixture.whenStable();
    const aide = (fixture.nativeElement as HTMLElement).querySelector('[data-aide-etape]')!;
    expect(aide.querySelector('h4')!.textContent!.trim()).toBe('Autres, hors parcours');
    expect(aide.textContent).toContain(CONSIGNE_AUTRES);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-raccourci]')).toHaveLength(9);
  });

  it('l’aide suit l’étape : « 3. Zones » et sa consigne ; puis 9 raccourcis, ①…⑧ et Échap, dérivés du parcours', async () => {
    const fixture = TestBed.createComponent(AideComponent);
    fixture.componentRef.setInput('etape', 'zones');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const aide = el.querySelector('[data-aide-etape]')!;
    expect(aide.querySelector('h4')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('3. Zones');
    expect(aide.textContent).toContain(CONSIGNE_ETAPE.zones);
    const lignes = [...el.querySelectorAll('[data-raccourci]')].map((l) => {
      const [nom, touches] = l.querySelectorAll(':scope > span');
      return [nom.textContent?.trim(), touches.textContent?.trim()];
    });
    expect(lignes).toEqual([
      ['1. Périmètre', 'Alt + 1'],
      ['2. Données', 'Alt + 2'],
      ['3. Zones', 'Alt + 3'],
      ['4. Analyse', 'Alt + 4'],
      ['5. Jeu de zones', 'Alt + 5'],
      ['6. Plan', 'Alt + 6'],
      ['7. Activation', 'Alt + 7'],
      ['8. Live', 'Alt + 8'],
      ['Fermer le tiroir, quitter le mode immersif', 'Échap'],
    ]);
    fixture.componentRef.setInput('etape', 'perimetre');
    await fixture.whenStable();
    expect(aide.querySelector('h4')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('1. Périmètre');
  });
});
