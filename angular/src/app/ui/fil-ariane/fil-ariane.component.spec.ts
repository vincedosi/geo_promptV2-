import { TestBed } from '@angular/core/testing';
import { FilArianeComponent } from './fil-ariane.component';

describe('FilArianeComponent', () => {
  it('chaque segment franchi remonte ; le dernier est désactivé', async () => {
    const f = TestBed.createComponent(FilArianeComponent);
    f.componentRef.setInput('segments', [
      { cle: 'fr', libelle: 'France entière' },
      { cle: 'r93', libelle: 'Provence-Alpes-Côte d\'Azur', titre: 'Région 93' },
      { cle: 'd13', libelle: 'Bouches-du-Rhône', titre: 'Département 13' },
    ]);
    f.componentRef.setInput('precision', 'Commune');
    const remontees: number[] = [];
    f.componentInstance.remonter.subscribe((i) => remontees.push(i));
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const boutons = el.querySelectorAll('button');
    boutons[0].click();
    boutons[1].click();
    expect(remontees).toEqual([0, 1]);
    expect(boutons[2].disabled).toBe(true);
    expect(boutons[1].getAttribute('title')).toBe('Région 93');
    // Affichée TELLE QUE reçue : DESIGN_SYSTEM.md garde les acronymes (IRIS,
    // INSEE…) en majuscules, et un `.toLowerCase()` les écraserait aussi.
    expect(el.textContent).toContain('Commune');
    expect(boutons[2].getAttribute('aria-current')).toBe('location');
    expect(boutons[0].getAttribute('aria-current')).toBeNull();
  });

  it('un seul segment : il est courant, donc désactivé', async () => {
    const f = TestBed.createComponent(FilArianeComponent);
    f.componentRef.setInput('segments', [{ cle: 'fr', libelle: 'France entière' }]);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('button')!.disabled).toBe(true);
  });

  it('ne modifie pas la casse d\'un acronyme (IRIS)', async () => {
    const f = TestBed.createComponent(FilArianeComponent);
    f.componentRef.setInput('segments', [{ cle: 'fr', libelle: 'France entière' }]);
    f.componentRef.setInput('precision', 'IRIS');
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).textContent).toContain('IRIS');
  });
});
