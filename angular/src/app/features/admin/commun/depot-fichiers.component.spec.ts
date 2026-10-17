import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DepotFichiersComponent } from './depot-fichiers.component';

@Component({
  imports: [DepotFichiersComponent],
  template: `
    <mg-depot-fichiers accepter=".csv,.tsv" [multiple]="multiple()" [desactive]="desactive()" [trait]="trait()" (fichiers)="recus.push($event)">
      <span>Glissez un fichier ici</span>
    </mg-depot-fichiers>
  `,
})
class Hote {
  readonly multiple = signal(false);
  readonly desactive = signal(false);
  readonly trait = signal<'tirets' | 'fin'>('tirets');
  readonly recus: File[][] = [];
}

/** jsdom n'a ni DragEvent ni DataTransfer : un événement portant `dataTransfer.files`. */
function evenementGlisser(type: string, fichiers: File[] = []): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: fichiers, dropEffect: 'none' } });
  return e;
}

const a = new File(['a'], 'a.csv', { type: 'text/csv' });
const b = new File(['b'], 'b.csv', { type: 'text/csv' });

async function monter() {
  const f = TestBed.createComponent(Hote);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { f, h: f.componentInstance, el, zone: el.querySelector('[data-zone]') as HTMLElement, champ: el.querySelector('input[type="file"]') as HTMLInputElement };
}

describe('DepotFichiersComponent', () => {
  it('projette son contenu et porte accept / multiple sur le champ fichier', async () => {
    const { f, h, el, champ } = await monter();
    expect(el.textContent).toContain('Glissez un fichier ici');
    expect(champ.accept).toBe('.csv,.tsv');
    expect(champ.multiple).toBe(false);
    h.multiple.set(true);
    await f.whenStable();
    expect(champ.multiple).toBe(true);
  });

  it('dépôt de deux fichiers sans `multiple` : seulement le premier', async () => {
    const { f, h, zone } = await monter();
    const depot = evenementGlisser('drop', [a, b]);
    zone.dispatchEvent(depot);
    expect(depot.defaultPrevented).toBe(true);
    await f.whenStable();
    expect(h.recus).toEqual([[a]]);
  });

  it('dépôt avec `multiple` : tous les fichiers', async () => {
    const { f, h, zone } = await monter();
    h.multiple.set(true);
    await f.whenStable();
    zone.dispatchEvent(evenementGlisser('drop', [a, b]));
    expect(h.recus).toEqual([[a, b]]);
  });

  it('survol de glisser : état visible, retiré en sortant ou au dépôt', async () => {
    const { f, zone } = await monter();
    const survol = evenementGlisser('dragover');
    zone.dispatchEvent(survol);
    expect(survol.defaultPrevented).toBe(true);
    await f.whenStable();
    expect(zone.classList).toContain('survol');
    zone.dispatchEvent(evenementGlisser('dragleave'));
    await f.whenStable();
    expect(zone.classList).not.toContain('survol');
  });

  it('clic et clavier ouvrent le sélecteur ; le choix est émis puis le champ vidé', async () => {
    const { f, h, zone, champ } = await monter();
    const ouvrir = vi.spyOn(champ, 'click').mockImplementation(() => undefined);
    zone.click();
    zone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ouvrir).toHaveBeenCalledTimes(2);
    Object.defineProperty(champ, 'files', { configurable: true, value: [a, b] });
    champ.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(h.recus).toEqual([[a]]);
  });

  it('désactivé : ni clic, ni dépôt', async () => {
    const { f, h, zone, champ } = await monter();
    h.desactive.set(true);
    await f.whenStable();
    const ouvrir = vi.spyOn(champ, 'click').mockImplementation(() => undefined);
    zone.click();
    zone.dispatchEvent(evenementGlisser('drop', [a]));
    expect(ouvrir).not.toHaveBeenCalled();
    expect(h.recus).toEqual([]);
    expect(zone.getAttribute('aria-disabled')).toBe('true');
  });

  it('trait : tirets épais par défaut ; `fin` (dialogue d’import DSP, T20) pose la classe du cadre fin', async () => {
    const { f, h, zone } = await monter();
    expect(zone.classList.contains('trait-fin')).toBe(false);
    h.trait.set('fin');
    await f.whenStable();
    expect(zone.classList.contains('trait-fin')).toBe(true);
  });
});
